// Loads one simulation run's inputs for the risk chain and stores the result.
import { formatUnits } from "ethers";
import type { z } from "zod";
import { CoiReport, DecisionSummary, type RiskChain } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { toFinding } from "../proposals/mapping.js";
import { computeRisk, RISK_CONFIG, type RiskConfig, type Vote } from "./chain.js";

/** MRD total supply (data/ANSWER_KEY.md invariant); turnout is measured against it. */
export const TOTAL_SUPPLY_MRD = 100_000_000;

/** VoteCast events -> votes in whole MRD (args are JSON strings of wei). */
export function votesOf(events: { args: unknown }[]): Vote[] {
  const out: Vote[] = [];
  for (const e of events) {
    const args = e.args as { voter?: unknown; weight?: unknown };
    if (typeof args.voter !== "string" || (typeof args.weight !== "string" && typeof args.weight !== "number")) continue;
    out.push({ voter: args.voter.toLowerCase(), weight: Number(formatUnits(BigInt(args.weight), 18)) });
  }
  return out;
}

/** Risk for a simulation run: claims and COI from its version (else the latest), votes from the chain, findings of the run. */
export async function riskForRun(db: Db, runId: string, config: RiskConfig = RISK_CONFIG): Promise<z.infer<typeof RiskChain>> {
  const run = await db.simulationRun.findUniqueOrThrow({ where: { id: runId }, include: { proposal: true, findings: { orderBy: { findingKey: "asc" } } } });
  const version = run.proposalVersionId
    ? await db.proposalVersion.findUnique({ where: { id: run.proposalVersionId }, include: { summary: true, coiReport: true } })
    : await db.proposalVersion.findFirst({ where: { proposalId: run.proposalId }, orderBy: { version: "desc" }, include: { summary: true, coiReport: true } });
  const votes = await db.chainEvent.findMany({ where: { proposalId: run.proposalId, contract: "MeridianGovernor", name: "VoteCast" }, select: { args: true } });
  return computeRisk(
    {
      proposalId: run.proposal.slug,
      summary: version?.summary ? DecisionSummary.parse(version.summary.data) : null,
      coi: version?.coiReport ? CoiReport.parse(version.coiReport.data) : null,
      votes: votesOf(votes),
      totalVotingPower: TOTAL_SUPPLY_MRD,
      findings: run.findings.map(toFinding),
      simulationSuccess: run.success,
    },
    config,
  );
}

export async function saveRisk(db: Db, run: { id: string; proposalId: string }, risk: z.infer<typeof RiskChain>): Promise<void> {
  await db.riskChainRecord.create({
    data: { proposalId: run.proposalId, simulationRunId: run.id, data: risk as unknown as Prisma.InputJsonValue, prior: risk.prior, posterior: risk.posterior, level: risk.level, action: risk.action },
  });
}
