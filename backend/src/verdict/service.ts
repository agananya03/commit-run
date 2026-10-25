// Findings for one simulation run, from the stored intent/summary/COI of a version. Used by the pipeline and the watchdog.
import { keccak256 } from "ethers";
import type { z } from "zod";
import { CoiReport, DecisionSummary, IntentSpec, SimulationResult, type Explanation, type Finding } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { canonicalBytes } from "../integrity/canonicalize.js";
import { evaluate } from "./rules.js";

type FindingT = z.infer<typeof Finding>;
type SharedFinding = import("../../../shared/schemas/types.js").Finding;
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Findings with absent optional keys removed (shared types have no explicit `undefined`; canonical JSON has none either). */
export function compactFindings(findings: FindingT[]): SharedFinding[] {
  return findings.map(({ simRef, ...f }) => (simRef ? { ...f, simRef } : f));
}

/** findingsHash passed to GovernanceGuard.flag(): keccak256 of the RFC 8785 canonical JSON of the findings. */
export function findingsHash(findings: FindingT[]): string {
  return keccak256(canonicalBytes(compactFindings(findings)));
}

/** Runs the said-vs-does rules on a stored run, against the given version's intent, summary and COI report. */
export async function findingsForRun(db: Db, runId: string, versionId: string): Promise<FindingT[]> {
  const run = await db.simulationRun.findUniqueOrThrow({ where: { id: runId } });
  return findingsForResult(db, SimulationResult.parse(run.data), versionId);
}

/** Same rules on a simulation result that is not stored (reverify's re-simulation). */
export async function findingsForResult(db: Db, sim: z.infer<typeof SimulationResult>, versionId: string): Promise<FindingT[]> {
  const version = await db.proposalVersion.findUniqueOrThrow({ where: { id: versionId }, include: { intentSpec: true, summary: true, coiReport: true } });
  if (!version.intentSpec) throw new Error(`version ${version.version} has no intent yet; run the pipeline (extractIntent) first`);
  return evaluate({
    intent: IntentSpec.parse(version.intentSpec.data),
    sim,
    summary: version.summary ? DecisionSummary.parse(version.summary.data) : null,
    coi: version.coiReport ? CoiReport.parse(version.coiReport.data) : null,
  });
}

/** Replaces the run's findings (a retry never duplicates rows) and, if given, its explanation. */
export async function storeFindings(db: Db, run: { id: string; proposalId: string }, findings: FindingT[], explanation?: z.infer<typeof Explanation>): Promise<void> {
  await db.$transaction([
    db.finding.deleteMany({ where: { simulationRunId: run.id } }),
    db.finding.createMany({
      data: findings.map((f) => ({ proposalId: run.proposalId, simulationRunId: run.id, findingKey: f.id, severity: f.severity, category: f.category, said: f.said, does: f.does, evidence: json(f.evidence), simRef: f.simRef ?? null })),
    }),
    ...(explanation ? [db.simulationRun.update({ where: { id: run.id }, data: { explanation: json(explanation) } })] : []),
  ]);
}
