import { getAddress } from "ethers";
import { hashCanonical, isHex32, ZERO_HASH, type Hex32 } from "./hash.js";
import { buildEvidenceTree, type EvidenceLeafInput } from "./merkle.js";

export const VERSION_SCHEMA = "proofofintent/version@1";

export interface VersionProposal {
  slug: string;
  title: string;
  proposer: string;
  /** Human-readable or encoded on-chain actions (JSON only; uint256 as strings). */
  onchainActions: unknown;
}

export interface CanonicalVersion {
  schema: typeof VERSION_SCHEMA;
  proposal: string;
  title: string;
  proposer: string;
  onchainActions: unknown;
  /** Sorted by sha256, then type. */
  files: { type: string; sha256: string }[];
  evidenceRoot: Hex32;
  prevHash: Hex32;
}

export interface BuiltVersion<F extends EvidenceLeafInput = EvidenceLeafInput> {
  canonicalJson: CanonicalVersion;
  versionHash: Hex32;
  prevHash: Hex32;
  evidenceRoot: Hex32;
  /** Input files with their Merkle proofs. */
  files: (F & { proof: Hex32[] })[];
}

export class BrokenChainError extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
    this.name = "BrokenChainError";
  }
}

/**
 * Builds one link of the hash chain. versionHash = keccak256(RFC 8785 canonical JSON of canonicalJson),
 * and canonicalJson contains prevHash, so each version commits to the entire history before it.
 * The slug is included so a version cannot be replayed under another proposal.
 */
export function buildVersion<F extends EvidenceLeafInput>(
  proposal: VersionProposal,
  files: readonly F[],
  prevHash: string,
): BuiltVersion<F> {
  const prev = prevHash.toLowerCase();
  if (!isHex32(prev)) throw new Error(`prevHash must be a 32-byte 0x hex string, got ${prevHash}`);

  const tree = buildEvidenceTree(files);
  const sortedFiles = files
    .map((f) => ({ type: f.type, sha256: f.sha256.toLowerCase() }))
    .sort((a, b) => (a.sha256 === b.sha256 ? a.type.localeCompare(b.type) : a.sha256 < b.sha256 ? -1 : 1));

  const canonicalJson: CanonicalVersion = {
    schema: VERSION_SCHEMA,
    proposal: proposal.slug,
    title: proposal.title,
    proposer: getAddress(proposal.proposer).toLowerCase(),
    onchainActions: proposal.onchainActions,
    files: sortedFiles,
    evidenceRoot: tree.root,
    prevHash: prev,
  };

  return {
    canonicalJson,
    versionHash: hashCanonical(canonicalJson),
    prevHash: prev,
    evidenceRoot: tree.root,
    files: tree.files,
  };
}

interface StoredVersion {
  versionHash: string;
  prevHash: string;
  evidenceRoot?: string;
  canonicalJson?: unknown;
}

/** Throws unless `next` extends `previous` (or is a valid first version when previous is null). */
export function assertNextVersion(previous: Pick<StoredVersion, "versionHash"> | null, next: StoredVersion, index = 0): void {
  const expected = previous ? previous.versionHash.toLowerCase() : ZERO_HASH;
  if (next.prevHash.toLowerCase() !== expected) {
    throw new BrokenChainError(`version ${index + 1}: prevHash ${next.prevHash} does not match previous versionHash ${expected}`, index);
  }
}

/**
 * Verifies a whole chain: every link points at its predecessor, and (when canonicalJson is present)
 * every versionHash, prevHash and evidenceRoot is recomputed from the stored JSON.
 */
export function verifyChain(versions: readonly StoredVersion[]): { ok: true } | { ok: false; index: number; reason: string } {
  try {
    versions.forEach((v, i) => {
      assertNextVersion(i === 0 ? null : (versions[i - 1] ?? null), v, i);
      if (v.canonicalJson === undefined) return;
      const json = v.canonicalJson as Partial<CanonicalVersion>;
      if (hashCanonical(v.canonicalJson) !== v.versionHash.toLowerCase()) {
        throw new BrokenChainError(`version ${i + 1}: versionHash does not match its canonical JSON`, i);
      }
      if (json.prevHash !== v.prevHash.toLowerCase()) {
        throw new BrokenChainError(`version ${i + 1}: prevHash differs from the one inside its canonical JSON`, i);
      }
      if (v.evidenceRoot !== undefined && json.evidenceRoot !== v.evidenceRoot.toLowerCase()) {
        throw new BrokenChainError(`version ${i + 1}: evidenceRoot differs from the one inside its canonical JSON`, i);
      }
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof BrokenChainError) return { ok: false, index: err.index, reason: err.message };
    throw err;
  }
}
