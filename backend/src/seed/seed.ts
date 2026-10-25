import type { Db } from "../db.js";
import type { ScenarioPlan } from "./scenarios.js";

export interface SeedOutcome {
  slug: string;
  proposalId: string;
  files: number;
}

/**
 * Upserts each Proposal by slug and replaces its STAGED evidence files (proposalVersionId = null).
 * Files already sealed into a ProposalVersion are never touched, so re-seeding cannot rewrite history.
 */
export async function seedScenarios(db: Db, plans: ScenarioPlan[]): Promise<SeedOutcome[]> {
  const outcomes: SeedOutcome[] = [];
  for (const plan of plans) {
    const outcome = await db.$transaction(async (tx) => {
      const proposal = await tx.proposal.upsert({
        where: { slug: plan.slug },
        create: { slug: plan.slug, title: plan.title, proposer: plan.proposer },
        update: { title: plan.title, proposer: plan.proposer },
      });
      await tx.evidenceFile.deleteMany({ where: { proposalId: proposal.id, proposalVersionId: null } });
      await tx.evidenceFile.createMany({
        data: plan.files.map((f) => ({ ...f, proposalId: proposal.id })),
      });
      return { slug: plan.slug, proposalId: proposal.id, files: plan.files.length };
    });
    outcomes.push(outcome);
  }
  return outcomes;
}
