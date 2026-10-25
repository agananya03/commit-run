// One processor per pipeline step. Each is idempotent per (proposalVersionId, step): if its output is
// already stored it returns early, so a retry or a re-run never duplicates rows or re-sends a commit.
import type { z } from "zod";
import type { PipelineStep } from "../../../shared/schemas/types.js";
import type { RagClient } from "../clients/ragClient.js";
import type { SimClient } from "../clients/simClient.js";
import type { DecisionSummary, IntentSpec } from "../contracts/schemas.js";
import { encodeActions } from "../chain/actions.js";
import type { DeploymentsT } from "../chain/contracts.js";
import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { ProposalService } from "../proposals/service.js";

export interface StepJobData {
  proposalId: string;
  slug: string;
  versionId: string;
}

export interface StepDeps {
  db: Db;
  rag: RagClient;
  sim: SimClient;
  proposals: ProposalService;
  deployments: DeploymentsT;
}

/** What a step returns (kept as the BullMQ job's return value, visible in /queues). */
export type StepResult = { cached?: true; placeholder?: true } & Record<string, unknown>;

type Processor = (data: StepJobData, deps: StepDeps) => Promise<StepResult>;

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function versionOf(db: Db, versionId: string) {
  return db.proposalVersion.findUniqueOrThrow({ where: { id: versionId }, include: { evidenceFiles: true } });
}

export const STEPS: Record<PipelineStep, Processor> = {
  /** rag /ingest with the version's evidence files (disclosures are not rag sources). */
  async ingest({ slug, versionId, proposalId }, { db, rag }) {
    const version = await versionOf(db, versionId);
    const files = version.evidenceFiles
      .filter((f): f is typeof f & { type: "forum" | "pdf" | "social" | "onchain" } => f.type !== "disclosure")
      .map((f) => ({ type: f.type, path: f.uri }));
    const chunks = await rag.ingest({ proposalId: slug, files });
    await db.proposal.updateMany({ where: { id: proposalId, status: "DRAFT" }, data: { status: "INGESTED" } });
    return { files: files.length, chunks: chunks.length };
  },

  async summarize({ slug, versionId }, { db, rag }) {
    if (await db.summary.findUnique({ where: { proposalVersionId: versionId } })) return { cached: true };
    const s: z.infer<typeof DecisionSummary> = await rag.summarize({ proposalId: slug });
    await db.summary.create({
      data: {
        proposalVersionId: versionId,
        data: json(s),
        tldr: s.tldr,
        amountUsd: s.treasuryImpact.amountUsd,
        pctOfTreasury: s.treasuryImpact.pctOfTreasury,
        unsupportedClaims: s.claims.filter((c) => c.support !== "supported").length,
      },
    });
    return { claims: s.claims.length };
  },

  async extractIntent({ slug, versionId }, { db, rag }) {
    if (await db.intentSpecRecord.findUnique({ where: { proposalVersionId: versionId } })) return { cached: true };
    const intent: z.infer<typeof IntentSpec> = await rag.extractIntent({ proposalId: slug });
    await db.intentSpecRecord.create({ data: { proposalVersionId: versionId, data: json(intent), confidence: intent.confidence, actionCount: intent.actions.length } });
    return { actions: intent.actions.length };
  },

  /** ProposalRegistry.commit for every uncommitted version (H5). */
  async commit({ proposalId, versionId }, { db, proposals }) {
    const v = await db.proposalVersion.findUniqueOrThrow({ where: { id: versionId } });
    if (v.commitTxHash) return { cached: true, txHash: v.commitTxHash };
    try {
      const r = await proposals.commit(proposalId);
      return { txHash: r.txHash, blockNumber: r.blockNumber, version: r.version };
    } catch (err) {
      if (err instanceof HttpError && err.code === "CONFLICT") return { cached: true };
      throw err;
    }
  },

  async coi() {
    return { placeholder: true, note: "COI wallet-graph engine lands in H9" };
  },

  /** sim /simulate on the calldata encoded from the version's on-chain actions. */
  async simulate({ proposalId, slug, versionId }, { db, sim, deployments }) {
    const existing = await db.simulationRun.findFirst({ where: { proposalVersionId: versionId, source: "PROPOSED" } });
    if (existing) return { cached: true, simHash: existing.simHash };
    const version = await versionOf(db, versionId);
    const actions = (version.canonicalJson as { onchainActions?: unknown }).onchainActions;
    const request = encodeActions(actions, deployments, slug);
    const result = await sim.simulate(request);
    await db.simulationRun.create({
      data: { proposalId, proposalVersionId: versionId, source: "PROPOSED", data: json(result), success: result.success, simHash: result.simHash, bytecodeHash: result.bytecodeHash },
    });
    return { success: result.success, calls: request.calldatas.length, simHash: result.simHash };
  },

  async verdict() {
    return { placeholder: true, note: "said-vs-does verdict engine lands in H11" };
  },

  async risk() {
    return { placeholder: true, note: "4-stage probabilistic risk chain lands in H13" };
  },
};
