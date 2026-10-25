// One plain-English explanation of a run's findings: rag /explain, or a template when rag (and its mock) is unavailable.
import type { z } from "zod";
import type { RagClient } from "../clients/ragClient.js";
import type { Explanation, Finding } from "../contracts/schemas.js";
import { HttpError } from "../errors.js";
import { compactFindings } from "./service.js";

type FindingT = z.infer<typeof Finding>;
type ExplanationT = z.infer<typeof Explanation>;

const LABEL: Record<FindingT["category"], string> = {
  recipient_mismatch: "pays a recipient the text never names",
  amount_mismatch: "moves a different amount than the text states",
  undeclared_action: "makes a call the text never mentions",
  ownership_change: "changes who owns a contract",
  unlimited_approval: "grants an unlimited token allowance",
  new_privileged_function: "adds a privileged function",
  coi: "links the proposer to an undisclosed wallet",
  unsupported_claim: "makes a claim nothing independent supports",
  contradiction: "makes a claim the evidence contradicts",
};

/** Deterministic fallback, built only from the findings themselves. */
export function templateExplanation(proposalId: string, findings: FindingT[]): ExplanationT {
  if (findings.length === 0) {
    return { headline: `${proposalId} does what it says`, paragraph: `The simulated execution of ${proposalId} matches its description: no undeclared recipients, amounts, calls, ownership changes or approvals were found.`, perFinding: [] };
  }
  const critical = findings.filter((f) => f.severity === "critical");
  const top = (critical.length > 0 ? critical : findings).slice(0, 3);
  const headline = critical.length > 0 ? `${proposalId} does not do what it says (${critical.length} critical)` : `${proposalId} needs review (${findings.length} finding${findings.length === 1 ? "" : "s"})`;
  const paragraph =
    `Compared with its description, the simulated execution of ${proposalId} ${[...new Set(top.map((f) => LABEL[f.category]))].join(", ")}. ` +
    top.map((f) => `${f.does}.`).join(" ") +
    (findings.length > top.length ? ` ${findings.length - top.length} more finding(s) are listed below.` : "");
  return { headline, paragraph, perFinding: findings.map((f) => ({ findingId: f.id, sentence: `It ${LABEL[f.category]}: ${f.does}.` })) };
}

/** rag /explain; falls back to the template only when rag is unreachable and has no mock (never on an invalid response). */
export async function explainFindings(rag: RagClient, proposalId: string, findings: FindingT[]): Promise<{ explanation: ExplanationT; source: "rag" | "template" }> {
  try {
    return { explanation: await rag.explain({ proposalId, findings: compactFindings(findings) }), source: "rag" };
  } catch (err) {
    if (err instanceof HttpError && err.code === "UPSTREAM_UNAVAILABLE") return { explanation: templateExplanation(proposalId, findings), source: "template" };
    throw err;
  }
}
