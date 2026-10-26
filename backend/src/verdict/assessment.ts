// Puts a run's technical assessment on the record: builds the report (verdict/report.ts) and attests its sha256 in
// ProposalRegistry. Idempotent: a report hash already attested for the proposal is not attested again.
import type { z } from "zod";
import { proposalNumericId, type RegistryClient } from "../chain/registry.js";
import { SimulationResult, type Finding } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import { toFinding } from "../proposals/mapping.js";
import { assessmentReport, type AssessmentReport } from "./report.js";

type FindingT = z.infer<typeof Finding>;

/** Where a reader fetches the report the hash was taken of (GET /proposals/:id/assessment?simHash=). */
export const assessmentUri = (slug: string, simHash: string) => `poi://${slug}/assessment/${simHash}`;

/** The report for a stored run, rebuilt from its simulation and findings (deterministic). */
export async function reportForRun(db: Db, runId: string, findings?: FindingT[]): Promise<AssessmentReport & { slug: string; simHash: string }> {
  const run = await db.simulationRun.findUniqueOrThrow({ where: { id: runId }, include: { proposal: true, findings: { orderBy: { findingKey: "asc" } } } });
  const sim = SimulationResult.parse(run.data);
  const source = run.source === "QUEUED" ? "QUEUED" : "PROPOSED";
  const report = assessmentReport(run.proposal.slug, source, sim, findings ?? run.findings.map(toFinding), run.forkBlock);
  return { ...report, slug: run.proposal.slug, simHash: sim.simHash };
}

export async function attestRun(db: Db, registry: RegistryClient, runId: string, findings?: FindingT[]): Promise<{ reportHash: string; txHash: string | null }> {
  const r = await reportForRun(db, runId, findings);
  const id = proposalNumericId(r.slug);
  const done = (await registry.assessments(id)).find((a) => a.reportHash === r.reportHash.toLowerCase());
  if (done) return { reportHash: r.reportHash, txHash: done.txHash };
  const receipt = await registry.attest(id, r.reportHash, r.simHash, assessmentUri(r.slug, r.simHash));
  return { reportHash: r.reportHash, txHash: receipt.txHash };
}
