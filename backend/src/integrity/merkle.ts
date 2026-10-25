import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { isHex32, type Hex32 } from "./hash.js";

/** Leaf = [fileType, sha256]. Encoded like OpenZeppelin's MerkleProof expects, so it verifies on-chain too. */
export const LEAF_ENCODING = ["string", "bytes32"] as const;

export interface EvidenceLeafInput {
  type: string;
  /** 0x-prefixed sha256 of the file bytes */
  sha256: string;
}

export interface EvidenceTree<F extends EvidenceLeafInput> {
  root: Hex32;
  /** Same order as the input files, each with its Merkle proof. */
  files: (F & { proof: Hex32[] })[];
}

/**
 * Builds the evidence Merkle tree. Leaves are sorted by the library, so the root does not depend on
 * the order files were ingested in. Rejects empty sets, malformed hashes and duplicate leaves.
 */
export function buildEvidenceTree<F extends EvidenceLeafInput>(files: readonly F[]): EvidenceTree<F> {
  if (files.length === 0) throw new Error("a version needs at least one evidence file");
  const seen = new Set<string>();
  const leaves = files.map((f): [string, string] => {
    const sha = f.sha256.toLowerCase();
    if (!isHex32(sha)) throw new Error(`bad sha256 for ${f.type}: ${f.sha256}`);
    const key = `${f.type}:${sha}`;
    if (seen.has(key)) throw new Error(`duplicate evidence file ${key}`);
    seen.add(key);
    return [f.type, sha];
  });

  const tree = StandardMerkleTree.of(leaves, [...LEAF_ENCODING]);
  return {
    root: tree.root as Hex32,
    files: files.map((f, i) => ({ ...f, proof: tree.getProof(i) as Hex32[] })),
  };
}

export function verifyEvidenceProof(root: string, file: EvidenceLeafInput, proof: readonly string[]): boolean {
  try {
    return StandardMerkleTree.verify(root, [...LEAF_ENCODING], [file.type, file.sha256.toLowerCase()], [...proof]);
  } catch {
    return false;
  }
}
