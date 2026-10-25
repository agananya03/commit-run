import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const ZERO = ethers.ZeroHash;
const h = (label: string): string => ethers.id(label);
const PROPOSAL = 21n;

async function deployRegistry() {
  const [committer, other] = await ethers.getSigners();
  const registry = await ethers.deployContract("ProposalRegistry");
  return { registry, committer, other };
}

describe("ProposalRegistry", () => {
  it("commits version 1 with prevHash = 0 and emits ProposalCommitted", async () => {
    const { registry, committer } = await loadFixture(deployRegistry);
    await expect(registry.commit(PROPOSAL, h("v1"), ZERO, h("root1"), "ipfs://v1"))
      .to.emit(registry, "ProposalCommitted")
      .withArgs(PROPOSAL, 1n, h("v1"), ZERO, h("root1"), "ipfs://v1", committer.address);
    expect(await registry.latestVersionHash(PROPOSAL)).to.equal(h("v1"));
  });

  it("chains version 2 onto version 1 and returns the full history", async () => {
    const { registry, committer } = await loadFixture(deployRegistry);
    await registry.commit(PROPOSAL, h("v1"), ZERO, h("root1"), "ipfs://v1");
    await registry.commit(PROPOSAL, h("v2"), h("v1"), h("root2"), "ipfs://v2");

    expect(await registry.getHistory(PROPOSAL)).to.deep.equal([h("v1"), h("v2")]);
    expect(await registry.versionCount(PROPOSAL)).to.equal(2n);
    const v2 = await registry.getVersion(PROPOSAL, 2);
    expect([v2.versionHash, v2.prevHash, v2.evidenceRoot, v2.uri, v2.committer])
      .to.deep.equal([h("v2"), h("v1"), h("root2"), "ipfs://v2", committer.address]);
  });

  it("rejects a wrong prevHash (no rewriting or forking history)", async () => {
    const { registry } = await loadFixture(deployRegistry);
    await registry.commit(PROPOSAL, h("v1"), ZERO, h("root1"), "ipfs://v1");

    await expect(registry.commit(PROPOSAL, h("v2"), h("forged"), h("root2"), "ipfs://v2"))
      .to.be.revertedWithCustomError(registry, "StalePrevHash")
      .withArgs(h("v1"), h("forged"));
    // Re-committing on top of genesis (an attempted fork) also fails.
    await expect(registry.commit(PROPOSAL, h("v1b"), ZERO, h("root1b"), "ipfs://v1b"))
      .to.be.revertedWithCustomError(registry, "StalePrevHash")
      .withArgs(h("v1"), ZERO);
  });

  it("rejects a non-zero prevHash for the first version", async () => {
    const { registry } = await loadFixture(deployRegistry);
    await expect(registry.commit(PROPOSAL, h("v1"), h("x"), h("root1"), "ipfs://v1"))
      .to.be.revertedWithCustomError(registry, "StalePrevHash")
      .withArgs(ZERO, h("x"));
  });

  it("only lets the first committer extend a proposal's chain", async () => {
    const { registry, committer, other } = await loadFixture(deployRegistry);
    await registry.commit(PROPOSAL, h("v1"), ZERO, h("root1"), "ipfs://v1");
    await expect(registry.connect(other).commit(PROPOSAL, h("v2"), h("v1"), h("root2"), "ipfs://v2"))
      .to.be.revertedWithCustomError(registry, "NotCommitter")
      .withArgs(committer.address, other.address);
  });

  it("keeps proposals independent and rejects empty hashes and unknown versions", async () => {
    const { registry, other } = await loadFixture(deployRegistry);
    await registry.commit(PROPOSAL, h("v1"), ZERO, h("root1"), "ipfs://v1");
    await registry.connect(other).commit(12n, h("mip12"), ZERO, h("r12"), "ipfs://12");
    expect(await registry.latestVersionHash(12n)).to.equal(h("mip12"));

    await expect(registry.commit(99n, ZERO, ZERO, h("r"), "x")).to.be.revertedWithCustomError(registry, "EmptyVersionHash");
    await expect(registry.getVersion(PROPOSAL, 0)).to.be.revertedWithCustomError(registry, "UnknownVersion");
    await expect(registry.getVersion(PROPOSAL, 2)).to.be.revertedWithCustomError(registry, "UnknownVersion");
  });
});
