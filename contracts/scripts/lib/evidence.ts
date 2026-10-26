import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { ethers } from "ethers";
import { hardhatAddress } from "./actions";

/**
 * What a proposer must bind to MeridianGovernor.proposeWithEvidence: the Merkle root of the proposal's evidence
 * files and their own wallet disclosure. Same file mapping and leaf encoding as the backend
 * (backend/src/seed/scenarios.ts EVIDENCE_FILES, backend/src/integrity/merkle.ts), so this root equals the
 * evidenceRoot the backend commits to ProposalRegistry for version 1 of the scenario.
 */
export const EVIDENCE_FILES: Readonly<Record<string, string>> = {
  "forum_thread.json": "forum",
  "proposal.pdf": "pdf",
  "social.json": "social",
  "onchain_actions.json": "onchain",
  "disclosure.json": "disclosure",
};

export const LEAF_ENCODING = ["string", "bytes32"];

export interface BoundEvidence {
  evidenceRoot: string;
  disclosedWallets: string[];
  disclosureUri: string;
}

const sha256 = (bytes: Buffer) => `0x${createHash("sha256").update(bytes).digest("hex")}`;

/** Merkle root over [fileType, sha256] leaves (order-independent: the library sorts leaves). */
export function evidenceRoot(files: { type: string; sha256: string }[]): string {
  return StandardMerkleTree.of(files.map((f) => [f.type, f.sha256.toLowerCase()]), LEAF_ENCODING).root;
}

/** The evidence and disclosure a scenario's proposer submits, read from data/scenarios/<slug>. */
export function scenarioEvidence(repoRoot: string, slug: string): BoundEvidence {
  const dir = join(repoRoot, "data", "scenarios", slug);
  const files = Object.entries(EVIDENCE_FILES)
    .filter(([name]) => existsSync(join(dir, name)))
    .map(([name, type]) => ({ type, sha256: sha256(readFileSync(join(dir, name))) }));
  if (files.length === 0) throw new Error(`no evidence files in ${dir}`);
  const disclosure = JSON.parse(readFileSync(join(dir, "disclosure.json"), "utf8")) as { walletIndices?: number[]; wallets?: string[] };
  const disclosedWallets = disclosure.wallets ?? (disclosure.walletIndices ?? []).map((i) => hardhatAddress(i));
  return { evidenceRoot: evidenceRoot(files), disclosedWallets, disclosureUri: `data/scenarios/${slug}/disclosure.json` };
}

/** Evidence for a proposal that has no documents of its own (the override vote): its description is the evidence. */
export function descriptionEvidence(description: string): BoundEvidence {
  return { evidenceRoot: evidenceRoot([{ type: "description", sha256: ethers.id(description) }]), disclosedWallets: [], disclosureUri: "" };
}

/** Mirrors MeridianGovernor.boundDescription: the description the Governor stores and hashes. */
export function boundDescription(description: string, root: string): string {
  return `${description}\n\nevidence: ${root.toLowerCase()}`;
}
