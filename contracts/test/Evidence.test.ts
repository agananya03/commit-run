import { expect } from "chai";
import { join } from "node:path";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { hardhatAddress } from "../scripts/lib/actions";
import { boundDescription, scenarioEvidence } from "../scripts/lib/evidence";

// No proposal without evidence and a disclosure (pillars 1 and 3), and technical assessments on the record.

const REPO = join(__dirname, "..", "..");

async function deploy() {
  const signers = await ethers.getSigners();
  const [deployer, watchdog] = signers;
  const proposer = signers[13]!; // MIP-21's proposer
  const token = await ethers.deployContract("MeridianToken", [deployer!.address]);
  const timelock = await ethers.deployContract("TimelockController", [60, [], [ethers.ZeroAddress], deployer!.address]);
  const governor = await ethers.deployContract("MeridianGovernor", [await token.getAddress(), await timelock.getAddress()]);
  const registry = await ethers.deployContract("ProposalRegistry");
  // one harmless call: the Governor needs a non-empty proposal
  const proposal = { targets: [await token.getAddress()], values: [0n], calldatas: [token.interface.encodeFunctionData("name")], description: "# MIP-21: VaultV2 storage packing and gas optimisation" };
  return { deployer: deployer!, watchdog: watchdog!, proposer, governor, registry, proposal };
}

describe("evidence-bound proposals", () => {
  it("closes plain propose(): every proposal must carry evidence and a disclosure", async () => {
    const { governor, proposer, proposal: p } = await loadFixture(deploy);
    await expect(governor.connect(proposer).propose(p.targets, p.values, p.calldatas, p.description)).to.be.revertedWithCustomError(governor, "EvidenceRequired");
    await expect(governor.connect(proposer).proposeWithEvidence(p.targets, p.values, p.calldatas, p.description, ethers.ZeroHash, [], "")).to.be.revertedWithCustomError(governor, "EmptyEvidenceRoot");
  });

  it("records the proposer's disclosure on-chain and binds the evidence root into the proposal id", async () => {
    const { governor, proposer, proposal: p } = await loadFixture(deploy);
    const e = scenarioEvidence(REPO, "MIP-21");
    const bound = boundDescription(p.description, e.evidenceRoot);
    expect(await governor.boundDescription(p.description, e.evidenceRoot)).to.equal(bound); // scripts and contract agree

    const proposalId = await governor.hashProposal(p.targets, p.values, p.calldatas, ethers.id(bound));
    await expect(governor.connect(proposer).proposeWithEvidence(p.targets, p.values, p.calldatas, p.description, e.evidenceRoot, e.disclosedWallets, e.disclosureUri))
      .to.emit(governor, "EvidenceBound")
      .withArgs(proposalId, proposer.address, e.evidenceRoot, e.disclosedWallets, e.disclosureUri)
      .and.to.emit(governor, "ProposalCreated");

    const [root, wallets, uri] = await governor.evidenceOf(proposalId);
    expect(root).to.equal(e.evidenceRoot);
    expect(wallets).to.deep.equal([hardhatAddress(13)]); // MIP-21 discloses only the author wallet...
    expect(wallets).to.not.include(hardhatAddress(14)); // ...not the alt wallet the code pays: a signed, on-chain omission
    expect(uri).to.equal("data/scenarios/MIP-21/disclosure.json");
  });

  it("the same payload with different evidence is a different proposal: the vote is about this evidence", async () => {
    const { governor, proposal: p } = await loadFixture(deploy);
    const a = scenarioEvidence(REPO, "MIP-21").evidenceRoot;
    const b = scenarioEvidence(REPO, "MIP-12").evidenceRoot;
    const id = (root: string) => governor.hashProposal(p.targets, p.values, p.calldatas, ethers.id(boundDescription(p.description, root)));
    expect(await id(a)).to.not.equal(await id(b));
  });
});

describe("technical assessments in ProposalRegistry", () => {
  it("attests report hashes for recorded proposals, keeping who attested and in what order", async () => {
    const { registry, deployer, watchdog } = await loadFixture(deploy);
    const report = ethers.id("report: proposed payload");
    const sim = ethers.id("sim: proposed");
    await expect(registry.attest(21, report, sim, "poi://MIP-21/assessment/proposed")).to.be.revertedWithCustomError(registry, "UnknownProposal");

    await registry.commit(21, ethers.id("v1"), ethers.ZeroHash, ethers.id("root"), "poi://MIP-21/v1");
    await expect(registry.attest(21, ethers.ZeroHash, sim, "")).to.be.revertedWithCustomError(registry, "EmptyReportHash");
    await expect(registry.attest(21, report, sim, "poi://MIP-21/assessment/proposed")).to.emit(registry, "AssessmentAttested").withArgs(21, 0, report, sim, "poi://MIP-21/assessment/proposed", deployer.address);
    const queued = ethers.id("report: queued payload");
    await registry.connect(watchdog).attest(21, queued, ethers.id("sim: queued"), "poi://MIP-21/assessment/queued");

    expect(await registry.assessmentCount(21)).to.equal(2n);
    const [r1, , , attester1] = await registry.getAssessment(21, 0);
    const [r2, , , attester2] = await registry.getAssessment(21, 1);
    expect([r1, attester1]).to.deep.equal([report, deployer.address]);
    expect([r2, attester2]).to.deep.equal([queued, watchdog.address]);
    await expect(registry.getAssessment(21, 2)).to.be.revertedWithCustomError(registry, "UnknownVersion");
  });
});
