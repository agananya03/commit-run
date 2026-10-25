import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../src/integrity/canonicalize.js";
import { hashCanonical, ZERO_HASH } from "../src/integrity/hash.js";
import { buildEvidenceTree, verifyEvidenceProof } from "../src/integrity/merkle.js";
import { assertNextVersion, BrokenChainError, buildVersion, verifyChain, type VersionProposal } from "../src/integrity/versionChain.js";
import { sha256Hex } from "../src/seed/scenarios.js";

const fixture = (name: string): Buffer => readFileSync(fileURLToPath(new URL(`./fixtures/scenarios/MIP-21/${name}`, import.meta.url)));

const proposal: VersionProposal = {
  slug: "MIP-21",
  title: "VaultV2: storage packing and gas optimisation",
  proposer: "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec",
  onchainActions: [{ contract: "Vault", function: "upgradeToAndCall", args: ["VaultV2", "reinitializeV2(alt)"] }],
};

const pdf = fixture("proposal.pdf");
const files = [
  { type: "forum", sha256: sha256Hex(fixture("forum_thread.json")) },
  { type: "pdf", sha256: sha256Hex(pdf) },
  { type: "social", sha256: sha256Hex(fixture("social.json")) },
  { type: "onchain", sha256: sha256Hex(fixture("onchain_actions.json")) },
];

describe("canonicalize (RFC 8785)", () => {
  it("matches the RFC 8785 section 3.2.3 example", () => {
    // Vector kept in fixture files: escape sequences must reach the parser byte-for-byte.
    const input: unknown = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/rfc8785-input.json", import.meta.url)), "utf8"));
    const expected = readFileSync(fileURLToPath(new URL("./fixtures/rfc8785-output.txt", import.meta.url)), "utf8");
    expect(canonicalize(input)).toBe(expected);
  });

  it("gives the same string and hash regardless of key order", () => {
    const a = { title: "x", proposer: "0xabc", nested: { b: 2, a: [1, { d: 4, c: 3 }] } };
    const b = { nested: { a: [1, { c: 3, d: 4 }], b: 2 }, proposer: "0xabc", title: "x" };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(hashCanonical(a)).toBe(hashCanonical(b));
    // ...but array order is meaningful.
    expect(hashCanonical({ x: [1, 2] })).not.toBe(hashCanonical({ x: [2, 1] }));
  });

  it("rejects values that are not plain JSON", () => {
    expect(() => canonicalize(10n)).toThrow(/bigint/);
    expect(() => canonicalize(undefined)).toThrow();
  });
});

describe("buildVersion", () => {
  it("is deterministic: same input gives the same versionHash, whatever the key or file order", () => {
    const v1 = buildVersion(proposal, files, ZERO_HASH);
    const reordered: VersionProposal = {
      onchainActions: [{ args: ["VaultV2", "reinitializeV2(alt)"], function: "upgradeToAndCall", contract: "Vault" }],
      proposer: proposal.proposer.toLowerCase(),
      title: proposal.title,
      slug: proposal.slug,
    };
    const v2 = buildVersion(reordered, [...files].reverse(), ZERO_HASH);
    expect(v2.versionHash).toBe(v1.versionHash);
    expect(v2.evidenceRoot).toBe(v1.evidenceRoot);
    expect(v1.versionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("puts title, proposer, actions, the sorted file list and prevHash in the canonical JSON", () => {
    const v = buildVersion(proposal, files, ZERO_HASH);
    expect(v.canonicalJson).toMatchObject({
      proposal: "MIP-21",
      title: proposal.title,
      proposer: proposal.proposer.toLowerCase(),
      onchainActions: proposal.onchainActions,
      prevHash: ZERO_HASH,
      evidenceRoot: v.evidenceRoot,
    });
    const shas = v.canonicalJson.files.map((f) => f.sha256);
    expect(shas).toEqual([...shas].sort());
    expect(hashCanonical(v.canonicalJson)).toBe(v.versionHash);
  });

  it("changes evidenceRoot and versionHash when one byte of the PDF changes", () => {
    const before = buildVersion(proposal, files, ZERO_HASH);
    const tampered = Buffer.from(pdf);
    tampered[10] = (tampered[10] ?? 0) ^ 0x01;
    const tamperedFiles = files.map((f) => (f.type === "pdf" ? { ...f, sha256: sha256Hex(tampered) } : f));
    const after = buildVersion(proposal, tamperedFiles, ZERO_HASH);
    expect(after.evidenceRoot).not.toBe(before.evidenceRoot);
    expect(after.versionHash).not.toBe(before.versionHash);
  });

  it("changes versionHash when any committed field changes", () => {
    const base = buildVersion(proposal, files, ZERO_HASH).versionHash;
    expect(buildVersion({ ...proposal, title: proposal.title + "!" }, files, ZERO_HASH).versionHash).not.toBe(base);
    expect(buildVersion({ ...proposal, slug: "MIP-22" }, files, ZERO_HASH).versionHash).not.toBe(base);
    expect(buildVersion({ ...proposal, onchainActions: [] }, files, ZERO_HASH).versionHash).not.toBe(base);
  });

  it("rejects a malformed prevHash or proposer", () => {
    expect(() => buildVersion(proposal, files, "0x1234")).toThrow(/prevHash/);
    expect(() => buildVersion({ ...proposal, proposer: "not-an-address" }, files, ZERO_HASH)).toThrow();
  });
});

describe("hash chain", () => {
  const v1 = buildVersion(proposal, files, ZERO_HASH);
  const disclosure = { type: "disclosure", sha256: sha256Hex(fixture("disclosure.json")) };
  const v2 = buildVersion(proposal, [...files, disclosure], v1.versionHash);

  it("accepts a correctly linked chain", () => {
    expect(() => assertNextVersion(null, v1)).not.toThrow();
    expect(() => assertNextVersion(v1, v2, 1)).not.toThrow();
    expect(verifyChain([v1, v2])).toEqual({ ok: true });
  });

  it("rejects a version whose prevHash is not the previous versionHash", () => {
    const forged = buildVersion(proposal, [...files, disclosure], ZERO_HASH); // claims to be a first version
    expect(() => assertNextVersion(v1, forged, 1)).toThrow(BrokenChainError);
    expect(verifyChain([v1, forged])).toMatchObject({ ok: false, index: 1 });
    // A first version must point at ZERO_HASH.
    expect(() => assertNextVersion(null, v2)).toThrow(BrokenChainError);
  });

  it("detects canonical JSON edited after the fact (stored hash no longer matches)", () => {
    const edited = { ...v1, canonicalJson: { ...v1.canonicalJson, title: "something else" } };
    expect(verifyChain([edited, v2])).toMatchObject({ ok: false, index: 0 });
  });

  it("detects a stored evidenceRoot that disagrees with the canonical JSON", () => {
    const swapped = { ...v1, evidenceRoot: v2.evidenceRoot };
    expect(verifyChain([swapped])).toMatchObject({ ok: false, index: 0 });
  });
});

describe("evidence Merkle tree", () => {
  const tree = buildEvidenceTree(files);

  it("gives every file a proof that verifies against the root", () => {
    expect(tree.files).toHaveLength(files.length);
    for (const f of tree.files) expect(verifyEvidenceProof(tree.root, f, f.proof)).toBe(true);
  });

  it("fails verification for a tampered file, a relabelled type or someone else's proof", () => {
    const [first, second] = tree.files;
    if (!first || !second) throw new Error("fixture too small");
    expect(verifyEvidenceProof(tree.root, { ...first, sha256: `0x${"0".repeat(64)}` }, first.proof)).toBe(false);
    expect(verifyEvidenceProof(tree.root, { ...first, type: "disclosure" }, first.proof)).toBe(false);
    expect(verifyEvidenceProof(tree.root, first, second.proof)).toBe(false);
  });

  it("rejects empty sets, bad hashes and duplicate files", () => {
    expect(() => buildEvidenceTree([])).toThrow(/at least one/);
    expect(() => buildEvidenceTree([{ type: "pdf", sha256: "0x12" }])).toThrow(/bad sha256/);
    expect(() => buildEvidenceTree([files[0]!, files[0]!])).toThrow(/duplicate/);
  });
});
