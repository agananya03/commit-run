import { ADDRESS_TO_INDEX } from "@/lib/coiGraph";
import { displayName } from "@/lib/moneyTrail";
import type { Citation, Finding, IntentSpec, SimulationResult } from "@/types/shared";

/**
 * "What the proposal said" next to "what the code does": a semantic comparison, not a source diff.
 * Each pair links a promise (verbatim, cited) to an observed consequence from the simulation. A pair is only
 * "broken" when a finding says so and the simulation shows the effect; anything the code can't settle is "unclear".
 */

export type PairStatus = "broken" | "matches" | "unclear";

export interface Effect {
  /** One line in plain words. */
  headline: string;
  /** Before → after state changes, if any. */
  changes: { what: string; before?: string; after: string }[];
  /** The decoded call behind it, for the curious. */
  call?: string;
}

export interface Pair {
  id: string;
  status: PairStatus;
  severity?: Finding["severity"];
  said: string;
  citations: Citation[];
  effect: Effect | null;
  /** The finding's own wording of what the code does. */
  does?: string;
  /** Where the evidence comes from when it isn't the simulation. */
  note?: string;
}

export interface Exclusion {
  text: string;
  status: "kept" | "broken" | "unchecked";
  why: string;
}

// Deterministic deploy:seed addresses (contracts/README.md), named the way a token holder would.
const CONTRACT_NAMES: Record<string, string> = {
  "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9": "DAO treasury",
  "0x0165878a594ca255338adfa4d48449f69242eb8f": "Vault",
  "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512": "USDC",
  "0x17f24d3b8bc1150553b54da30b4d993acb889212": "VaultV2 code",
  "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707": "VaultV1 code",
  "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0": "Timelock",
  "0x5fbdb2315678afecb367f032d93f642f64180aa3": "MRD token",
  "0x0000000000000000000000000000000000000000": "nobody",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "DAO treasury", "Benchmark Runner (wallet #14)", or a short address. */
export function nameOf(addr: string): string {
  const a = addr.toLowerCase();
  if (CONTRACT_NAMES[a]) return CONTRACT_NAMES[a]!;
  const i = ADDRESS_TO_INDEX[a];
  if (i !== undefined) {
    const n = displayName(i);
    return n.startsWith("Wallet #") ? n : `${n} (wallet #${i})`;
  }
  return short(addr);
}

const MAX_UINT = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
function tokenAmount(amount: string, token: string): string {
  if (amount === MAX_UINT) return "unlimited";
  const decimals = nameOf(token) === "USDC" ? 6 : 18;
  const scale = BigInt(`1${"0".repeat(Math.max(0, decimals - 2))}`); // no bigint ** under the ES5 target
  const n = Number(BigInt(amount) / scale) / 100;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${nameOf(token) === "USDC" ? "USDC" : nameOf(token)}`;
}

/** The simulated consequence that backs a finding of this category. */
function effectFor(category: Finding["category"], sim: SimulationResult | null | undefined): Effect | null {
  if (!sim) return null;
  const callFor = (pred: (sig: string) => boolean) => sim.decodedCalls.find((c) => c.signature && pred(c.signature));
  const sig = (c?: SimulationResult["decodedCalls"][number]) => (c ? `${c.contractName ?? nameOf(c.target)}.${c.signature ?? c.selector}` : undefined);
  switch (category) {
    case "ownership_change": {
      const o = sim.ownershipChanges[0];
      if (!o) return null;
      return {
        headline: `${nameOf(o.after)} becomes the ${o.role} of the ${nameOf(o.contract)}.`,
        changes: sim.ownershipChanges.map((x) => ({ what: `${nameOf(x.contract)} ${x.role}`, before: nameOf(x.before), after: nameOf(x.after) })),
        call: sig(callFor((s) => s.startsWith("upgradeTo"))),
      };
    }
    case "unlimited_approval": {
      const a = sim.approvals[0];
      if (!a) return null;
      return {
        headline: `${nameOf(a.spender)} may spend ${tokenAmount(a.amount, a.token)} of the ${nameOf(a.owner)}'s ${nameOf(a.token)}.`,
        changes: sim.approvals.map((x) => ({ what: `${nameOf(x.owner)} → ${nameOf(x.spender)} allowance`, before: "0", after: tokenAmount(x.amount, x.token) })),
        call: sig(callFor((s) => s.startsWith("approve"))),
      };
    }
    case "new_privileged_function": {
      const impl = sim.implementationChanges.find((i) => i.addedSelectors.length > 0);
      if (!impl) return null;
      return {
        headline: `The new code adds ${impl.addedSelectors.length} function${impl.addedSelectors.length > 1 ? "s" : ""} nobody mentioned.`,
        changes: impl.addedSelectors.map((s) => ({ what: "new function", after: s.signature ?? s.selector })),
        call: sig(callFor((s) => s.startsWith("upgradeTo"))),
      };
    }
    case "amount_mismatch":
    case "recipient_mismatch": {
      const t = sim.tokenTransfers[0];
      if (!t) return null;
      return {
        headline: `The ${nameOf(t.from)} sends ${tokenAmount(t.amount, t.token)} to ${nameOf(t.to)}.`,
        changes: sim.tokenTransfers.map((x) => ({ what: `${nameOf(x.token)} to ${nameOf(x.to)}`, before: "0", after: tokenAmount(x.amount, x.token) })),
        call: sig(callFor((s) => s.startsWith("transfer"))),
      };
    }
    case "undeclared_action": {
      const c = sim.decodedCalls[0];
      return c ? { headline: `Calls ${sig(c)}.`, changes: [], call: sig(c) } : null;
    }
    default:
      return null;
  }
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export function buildPairs(intent: IntentSpec | null | undefined, sim: SimulationResult | null | undefined, findings: Finding[] = []): { pairs: Pair[]; exclusions: Exclusion[] } {
  const pairs: Pair[] = [];
  const covered = new Set<string>();

  for (const f of [...findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])) {
    const effect = effectFor(f.category, sim);
    if (f.category === "coi") {
      pairs.push({ id: f.id, status: "broken", severity: f.severity, said: f.said, citations: f.evidence, effect: null, does: f.does, note: "From the money trail, not the code" });
      continue;
    }
    if (effect) covered.add(f.category);
    pairs.push({
      id: f.id,
      // a finding with no simulated effect behind it is reported, but not as proven
      status: effect ? "broken" : "unclear",
      severity: f.severity,
      said: f.said,
      citations: f.evidence,
      effect,
      does: f.does,
    });
  }

  // promised actions the simulation confirms (unless a finding already disputes that transfer)
  (intent?.actions ?? []).forEach((a, i) => {
    if (a.kind === "transfer" && !covered.has("amount_mismatch") && !covered.has("recipient_mismatch")) {
      const t = sim?.tokenTransfers.find((x) => a.amount && x.amount === a.amount);
      // the amount alone isn't enough: when the text names a recipient, the money must go there
      const promisedIdx = a.recipient ? (/index\s+(\d+)/i.exec(a.recipient)?.[1] ?? null) : null;
      const promisedAddr = a.recipient && /^0x[0-9a-f]{40}$/i.test(a.recipient) ? a.recipient.toLowerCase() : null;
      const actualIdx = t ? ADDRESS_TO_INDEX[t.to.toLowerCase()] : undefined;
      const wrongRecipient = Boolean(t && ((promisedIdx !== null && String(actualIdx) !== promisedIdx) || (promisedAddr !== null && promisedAddr !== t.to.toLowerCase())));
      pairs.push({
        id: `action-${i}`,
        status: t && !wrongRecipient ? "matches" : "unclear",
        said: a.description,
        citations: a.citations,
        effect: t
          ? {
              headline: wrongRecipient
                ? `The amount matches, but the ${nameOf(t.from)} sends it to ${nameOf(t.to)}, not ${a.recipient}.`
                : `The ${nameOf(t.from)} sends exactly ${tokenAmount(t.amount, t.token)} to ${nameOf(t.to)}.`,
              changes: [{ what: `${nameOf(t.token)} to ${nameOf(t.to)}`, before: "0", after: tokenAmount(t.amount, t.token) }],
            }
          : null,
        ...(t ? {} : { note: "No matching transfer in the simulation" }),
      });
    }
    if (a.kind === "upgrade") {
      const u = sim?.implementationChanges.find((x) => a.target && x.proxy.toLowerCase() === a.target.toLowerCase());
      if (u)
        pairs.push({
          id: `action-${i}`,
          status: "matches",
          said: a.description,
          citations: a.citations,
          effect: { headline: `The ${nameOf(u.proxy)} switches to new code, as described.`, changes: [{ what: `${nameOf(u.proxy)} code`, before: nameOf(u.before), after: nameOf(u.after) }] },
        });
    }
  });

  // promises about what will NOT happen, checked against what the simulation saw
  const exclusions: Exclusion[] = (intent?.explicitlyExcluded ?? []).map((raw) => {
    const t = raw.toLowerCase();
    // the extractor stores what is excluded ("change to ownership"); say it as the promise it is
    const text = /^(no|not|never)\b|preserved|unchanged|remain/.test(t) ? raw.charAt(0).toUpperCase() + raw.slice(1) : `No ${raw}`;
    if (/owner|role/.test(t)) {
      const broken = (sim?.ownershipChanges.length ?? 0) > 0;
      return { text, status: broken ? "broken" : "kept", why: broken ? "Ownership changes in the simulation." : "No ownership change in the simulation." };
    }
    if (/upgrade|contract change|proxy|bytecode/.test(t)) {
      const broken = (sim?.implementationChanges.length ?? 0) > 0;
      return { text, status: broken ? "broken" : "kept", why: broken ? "The code is replaced in the simulation." : "No contract code changes in the simulation." };
    }
    if (/admin|privilege/.test(t)) {
      const broken = (sim?.implementationChanges.some((i) => i.addedSelectors.length > 0) ?? false) || (sim?.ownershipChanges.length ?? 0) > 0;
      return { text, status: broken ? "broken" : "kept", why: broken ? "New powers appear in the simulation." : "No new admin powers in the simulation." };
    }
    if (/reserve/.test(t)) {
      const broken = (sim?.approvals.length ?? 0) > 0 || (sim?.tokenTransfers.length ?? 0) > 0;
      return { text, status: broken ? "broken" : "kept", why: broken ? "Reserves can move in the simulation." : "Reserves don't move in the simulation." };
    }
    return { text, status: "unchecked", why: "The code can't confirm or deny this one." };
  });

  return { pairs, exclusions };
}
