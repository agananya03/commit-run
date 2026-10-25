// Said-vs-does verdict rules: compares what the proposal text promised with what the simulation shows.
import { getAddress, isAddress } from "ethers";
import type { z } from "zod";
import type { Citation, CoiReport, DecisionSummary, Finding, IntentSpec, SimulationResult } from "../contracts/schemas.js";
import { hardhatAddress } from "../seed/scenarios.js";

type FindingT = z.infer<typeof Finding>;
type CitationT = z.infer<typeof Citation>;
type IntentT = z.infer<typeof IntentSpec>;
type ActionT = IntentT["actions"][number];

export const VERDICT_CONFIG = {
  /** Relative difference above which a transfer amount does not match the intent. */
  amountTolerance: 0.01,
  /** approve(amount >= 2^255) counts as unlimited. */
  unlimitedApproval: 2n ** 255n,
  privilegedName: /withdraw|migrate|sweep|setowner|upgrade|initialize|selfdestruct|delegate/i,
  coiMinPLink: 0.7,
} as const;

const SEVERITY_ORDER: FindingT["severity"][] = ["critical", "high", "medium", "low", "info"];

const lc = (a: string) => a.toLowerCase();
const fnName = (signature?: string) => (signature ?? "").split("(")[0]!;

/** Intent recipients are addresses or D's "wallet index N (...)" wording. */
export function resolveAddress(text: string | undefined): string | null {
  if (!text) return null;
  const hex = text.match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (hex && isAddress(hex)) return lc(getAddress(hex));
  const idx = text.match(/(?:wallet|account)\s*(?:index\s*)?#?(\d+)/i)?.[1];
  return idx !== undefined ? lc(hardhatAddress(Number(idx))) : null;
}

const quote = (c: CitationT) => `"${c.quote}" (${c.sourceUri})`;

/** 'said' text and evidence for an action, or for the intent as a whole when nothing matches. */
function saidOf(intent: IntentT, action?: ActionT): { said: string; evidence: CitationT[] } {
  if (action) {
    const c = action.citations[0];
    return { said: c ? `${action.description} — ${quote(c)}` : action.description, evidence: action.citations };
  }
  const excluded = intent.explicitlyExcluded.length ? ` Explicitly excluded: ${intent.explicitlyExcluded.join("; ")}.` : "";
  return { said: `Not described. The proposal says: "${intent.summary}"${excluded}`, evidence: intent.actions.flatMap((a) => a.citations).slice(0, 2) };
}

const KIND_FUNCTIONS: Record<ActionT["kind"], RegExp> = {
  transfer: /^(transfer|transferFrom|safeTransfer|safeTransferFrom)$/,
  upgrade: /^(upgradeTo|upgradeToAndCall)$/,
  approve: /^(approve|increaseAllowance)$/,
  param_change: /^(set|update)/,
  call: /.*/,
};

function covers(action: ActionT, call: { target: string; signature?: string | undefined }): boolean {
  const name = fnName(call.signature);
  const fnOk = action.functionSignature ? fnName(action.functionSignature) === name : KIND_FUNCTIONS[action.kind].test(name);
  if (!fnOk) return false;
  if (!action.target) return true;
  return resolveAddress(action.target) === lc(call.target);
}

export interface VerdictInput {
  intent: IntentT;
  sim: z.infer<typeof SimulationResult>;
  summary: z.infer<typeof DecisionSummary> | null;
  coi: z.infer<typeof CoiReport> | null;
}

export function evaluate({ intent, sim, summary, coi }: VerdictInput, config = VERDICT_CONFIG): FindingT[] {
  const out: Omit<FindingT, "id">[] = [];
  const recipients = new Map<string, ActionT>();
  for (const a of intent.actions) {
    const r = resolveAddress(a.recipient);
    if (r) recipients.set(r, a);
  }

  sim.tokenTransfers.forEach((t, i) => {
    const simRef = `tokenTransfers[${i}]`;
    const action = recipients.get(lc(t.to));
    if (!action) {
      out.push({ severity: "critical", category: "recipient_mismatch", ...saidOf(intent, intent.actions.find((a) => a.kind === "transfer")), does: `Transfers ${t.amount} of ${t.token} to ${t.to}, which no intent action names as a recipient`, simRef });
      return;
    }
    if (action.amount && /^\d+$/.test(action.amount)) {
      const said = BigInt(action.amount);
      const does = BigInt(t.amount);
      const diff = said > does ? said - does : does - said;
      if (said === 0n ? does !== 0n : Number(diff) / Number(said) > config.amountTolerance) {
        out.push({ severity: "high", category: "amount_mismatch", ...saidOf(intent, action), does: `Transfers ${t.amount} (intent: ${action.amount}) of ${t.token} to ${t.to}`, simRef });
      }
    }
  });

  sim.decodedCalls.forEach((c, i) => {
    if (intent.actions.some((a) => covers(a, c))) return;
    out.push({ severity: "high", category: "undeclared_action", ...saidOf(intent), does: `Calls ${c.signature ?? c.selector} on ${c.contractName ?? c.target}`, simRef: `decodedCalls[${i}]` });
  });

  const mentionsOwnership = intent.actions.some((a) => /owner/i.test(`${a.description} ${a.functionSignature ?? ""}`));
  sim.ownershipChanges.forEach((o, i) => {
    if (mentionsOwnership) return;
    out.push({ severity: "critical", category: "ownership_change", ...saidOf(intent), does: `${o.role} of ${o.contract} changes from ${o.before} to ${o.after}`, simRef: `ownershipChanges[${i}]` });
  });

  sim.approvals.forEach((a, i) => {
    if (BigInt(a.amount) < config.unlimitedApproval) return;
    out.push({ severity: "critical", category: "unlimited_approval", ...saidOf(intent, intent.actions.find((x) => x.kind === "approve")), does: `${a.owner} grants ${a.spender} an unlimited allowance of ${a.token}`, simRef: `approvals[${i}]` });
  });

  sim.implementationChanges.forEach((impl, i) => {
    impl.addedSelectors.forEach((s, j) => {
      if (!config.privilegedName.test(fnName(s.signature))) return;
      out.push({ severity: "high", category: "new_privileged_function", ...saidOf(intent, intent.actions.find((a) => a.kind === "upgrade")), does: `New implementation ${impl.after} adds ${s.signature ?? s.selector}`, simRef: `implementationChanges[${i}].addedSelectors[${j}]` });
    });
  });

  for (const claim of summary?.claims ?? []) {
    if (claim.support === "supported") continue;
    const c = claim.citations[0];
    const said = c ? `${claim.text} — ${quote(c)}` : claim.text;
    if (claim.support === "contradicted") out.push({ severity: "high", category: "contradiction", said, does: `Contradicted by independent evidence (pSupported ${claim.pSupported})`, evidence: claim.citations });
    else out.push({ severity: "medium", category: "unsupported_claim", said, does: `No independent evidence supports this claim (pSupported ${claim.pSupported})`, evidence: claim.citations });
  }

  for (const link of coi?.undisclosedLinks ?? []) {
    if (link.pLink <= config.coiMinPLink) continue;
    const said = coi!.signatureValid ? `Signed disclosure lists: ${coi!.disclosed.join(", ") || "no wallets"}` : "No validly signed disclosure of the proposer's wallets";
    out.push({ severity: "high", category: "coi", said, does: `Undisclosed link (pLink ${link.pLink}): ${link.reasons.join("; ")}`, evidence: [] });
  }

  // Stable order: severity, then rule order above; ids f1, f2, ... follow it.
  return out
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.f.severity) - SEVERITY_ORDER.indexOf(b.f.severity) || a.i - b.i)
    .map(({ f }, i) => ({ id: `f${i + 1}`, ...f }));
}
