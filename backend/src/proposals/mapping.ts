// Prisma rows -> shared contract shapes (/shared/schemas/types.ts).
import type { z } from "zod";
import type { ChainEvent, EvidenceFile, Finding, Proposal, ProposalVersion } from "../contracts/schemas.js";
import type * as Db from "../generated/prisma/client.js";
import { buildEvidenceTree } from "../integrity/merkle.js";

export const toProposal = (p: Db.Proposal): z.infer<typeof Proposal> => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  proposer: p.proposer,
  status: p.status,
  governorProposalId: p.governorProposalId,
  operationId: p.operationId,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

/** Proofs are recomputed from the version's files (cheap, and always consistent with evidenceRoot). */
export function toVersion(v: Db.ProposalVersion & { evidenceFiles: Db.EvidenceFile[] }): z.infer<typeof ProposalVersion> {
  const files = v.evidenceFiles.length > 0 ? buildEvidenceTree(v.evidenceFiles).files : [];
  return {
    proposalId: v.proposalId,
    version: v.version,
    canonicalJson: v.canonicalJson,
    versionHash: v.versionHash,
    prevHash: v.prevHash,
    evidenceRoot: v.evidenceRoot,
    commitTxHash: v.commitTxHash,
    files: files.map((f): z.infer<typeof EvidenceFile> => ({ type: f.type, uri: f.uri, sha256: f.sha256, bytes: f.bytes, proof: f.proof })),
    createdAt: v.createdAt.toISOString(),
  };
}

export const toFinding = (f: Db.Finding): z.infer<typeof Finding> => ({
  id: f.findingKey,
  severity: f.severity,
  category: f.category,
  said: f.said,
  does: f.does,
  evidence: f.evidence as z.infer<typeof Finding>["evidence"],
  ...(f.simRef ? { simRef: f.simRef } : {}),
});

export const toChainEvent = (e: Db.ChainEvent, slug: string | null): z.infer<typeof ChainEvent> => ({
  proposalId: slug,
  contract: e.contract,
  name: e.name,
  args: e.args as Record<string, unknown>,
  blockNumber: e.blockNumber,
  txHash: e.txHash,
  logIndex: e.logIndex,
});
