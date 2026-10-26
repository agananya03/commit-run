// The technical assessment: a Seatbelt-style markdown report of one simulation run and its findings. It is
// deterministic (no clocks, stable order), so anyone can rebuild it from the run and re-hash it against the
// sha256 the watchdog attests in ProposalRegistry.
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { Finding, SimulationResult } from "../contracts/schemas.js";
import { findingsHash } from "./service.js";

type Sim = z.infer<typeof SimulationResult>;
type FindingT = z.infer<typeof Finding>;

const MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
const amount = (raw: string) => (raw === MAX ? "unlimited (2^256 − 1)" : raw);

export interface AssessmentReport {
  markdown: string;
  /** 0x-prefixed sha256 of the UTF-8 markdown: the hash attested on-chain */
  reportHash: string;
}

export function assessmentReport(slug: string, source: "PROPOSED" | "QUEUED", sim: Sim, findings: FindingT[], forkBlock: number | null): AssessmentReport {
  const L: string[] = [];
  L.push(`# Technical assessment: ${slug} (${source === "QUEUED" ? "exact queued payload" : "payload as proposed"})`, "");
  L.push(`- Simulation: ${sim.success ? "succeeded" : `reverted${sim.revertReason ? `: ${sim.revertReason}` : ""}`}`);
  L.push(`- simHash: \`${sim.simHash}\``, `- bytecodeHash: \`${sim.bytecodeHash}\``);
  L.push(`- Fork block: ${forkBlock ?? "chain head"}`, `- findingsHash: \`${findingsHash(findings)}\``, "");

  L.push("## Calls", "", "| # | Target | Function |", "|---|---|---|");
  sim.decodedCalls.forEach((c, i) => L.push(`| ${i + 1} | ${cell(c.contractName ?? c.target)} | \`${cell(c.signature ?? c.selector)}\` |`));
  L.push("");

  L.push("## State changes", "");
  const section = (title: string, rows: string[]) => L.push(`### ${title}`, "", ...(rows.length ? rows : ["None."]), "");
  section("Ownership", sim.ownershipChanges.map((o) => `- ${o.role} of \`${o.contract}\`: \`${o.before}\` → \`${o.after}\``));
  section("Token approvals", sim.approvals.map((a) => `- \`${a.owner}\` lets \`${a.spender}\` spend ${amount(a.amount)} of \`${a.token}\``));
  section("Token transfers", sim.tokenTransfers.map((t) => `- \`${t.from}\` → \`${t.to}\`: ${t.amount} of \`${t.token}\``));
  section(
    "Code upgrades",
    sim.implementationChanges.map((u) => {
      const added = u.addedSelectors.map((s) => s.signature ?? s.selector).join(", ") || "none";
      const removed = u.removedSelectors.map((s) => s.signature ?? s.selector).join(", ") || "none";
      return `- \`${u.proxy}\`: \`${u.before}\` → \`${u.after}\`; added: ${added}; removed: ${removed}`;
    }),
  );

  L.push("## Promise vs code", "");
  if (findings.length === 0) L.push("The simulated execution matches the stated intent: no findings.");
  for (const f of findings) L.push(`- **${f.severity.toUpperCase()} ${f.category}** (${f.id}). Said: "${f.said}". Does: ${f.does}`);
  L.push("");

  const markdown = `${L.join("\n")}\n`;
  return { markdown, reportHash: `0x${createHash("sha256").update(markdown, "utf8").digest("hex")}` };
}
