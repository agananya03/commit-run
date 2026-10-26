import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";
import { boundDescription, descriptionEvidence } from "../scripts/lib/evidence";

// Governor ProposalState enum
const State = { Pending: 0n, Active: 1n, Defeated: 3n, Succeeded: 4n, Queued: 5n, Executed: 7n } as const;
const VOTE_FOR = 1;
const MIN_DELAY = 60; // seconds, as in the demo deploy
const usdc6 = (n: number): bigint => ethers.parseUnits(n.toString(), 6);
const mrd = (n: number): bigint => ethers.parseEther(n.toString());

async function deployDao() {
  const [deployer, voterA, voterB, grantee, outsider] = await ethers.getSigners();

  const token = await ethers.deployContract("MeridianToken", [deployer.address]);
  const usdc = await ethers.deployContract("MockUSDC", [deployer.address]);
  // proposers set below; executors = [0x0] lets anyone execute a ready operation
  const timelock = await ethers.deployContract("TimelockController", [MIN_DELAY, [], [ethers.ZeroAddress], deployer.address]);
  const governor = await ethers.deployContract("MeridianGovernor", [await token.getAddress(), await timelock.getAddress()]);
  const treasury = await ethers.deployContract("Treasury", [await timelock.getAddress()]);

  // Only the governor may schedule or cancel; then the deployer gives up admin.
  const governorAddr = await governor.getAddress();
  await timelock.grantRole(await timelock.PROPOSER_ROLE(), governorAddr);
  await timelock.grantRole(await timelock.CANCELLER_ROLE(), governorAddr);
  await timelock.renounceRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);

  await usdc.mint(await treasury.getAddress(), usdc6(20_000_000));

  // 100M supply, quorum 4% = 4M. Voters hold 3M + 2M; deployer keeps the rest undelegated.
  await token.transfer(voterA.address, mrd(3_000_000));
  await token.transfer(voterB.address, mrd(2_000_000));
  await token.connect(voterA).delegate(voterA.address);
  await token.connect(voterB).delegate(voterB.address);

  return { deployer, voterA, voterB, grantee, outsider, token, usdc, timelock, governor, treasury };
}

async function proposeGrant(f: Awaited<ReturnType<typeof deployDao>>, amount: bigint) {
  const targets = [await f.treasury.getAddress()];
  const values = [0n];
  const calldatas = [f.treasury.interface.encodeFunctionData("transfer", [await f.usdc.getAddress(), f.grantee.address, amount])];
  const description = "MIP-12: grant 1000 USDC to the SDK studio";
  const e = descriptionEvidence(description);
  const descriptionHash = ethers.id(boundDescription(description, e.evidenceRoot));

  await f.governor.connect(f.voterA).proposeWithEvidence(targets, values, calldatas, description, e.evidenceRoot, e.disclosedWallets, e.disclosureUri);
  const proposalId = await f.governor.hashProposal(targets, values, calldatas, descriptionHash);
  return { targets, values, calldatas, descriptionHash, proposalId };
}

describe("Meridian DAO governance", () => {
  it("deploys tokens with the expected supply and decimals", async () => {
    const { token, usdc, deployer } = await loadFixture(deployDao);
    expect(await token.symbol()).to.equal("MRD");
    expect(await token.totalSupply()).to.equal(mrd(100_000_000));
    expect(await usdc.decimals()).to.equal(6n);
    expect(await token.balanceOf(deployer.address)).to.equal(mrd(95_000_000));
  });

  it("uses the configured governor settings", async () => {
    const { governor } = await loadFixture(deployDao);
    expect(await governor.votingDelay()).to.equal(1n);
    expect(await governor.votingPeriod()).to.equal(20n);
    expect(await governor.proposalThreshold()).to.equal(0n);
    expect(await governor["quorumNumerator()"]()).to.equal(4n);
  });

  it("passes and executes a 1000 USDC treasury transfer through the timelock", async () => {
    const f = await loadFixture(deployDao);
    const p = await proposeGrant(f, usdc6(1000));
    expect(await f.governor.state(p.proposalId)).to.equal(State.Pending);

    await mine(2); // past the 1-block voting delay
    expect(await f.governor.state(p.proposalId)).to.equal(State.Active);
    await f.governor.connect(f.voterA).castVote(p.proposalId, VOTE_FOR);
    await f.governor.connect(f.voterB).castVote(p.proposalId, VOTE_FOR);

    await mine(21); // past the 20-block voting period
    expect(await f.governor.state(p.proposalId)).to.equal(State.Succeeded);

    await f.governor.queue(p.targets, p.values, p.calldatas, p.descriptionHash);
    expect(await f.governor.state(p.proposalId)).to.equal(State.Queued);

    await time.increase(MIN_DELAY + 1);
    await expect(f.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash))
      .to.emit(f.treasury, "Sent")
      .withArgs(await f.usdc.getAddress(), f.grantee.address, usdc6(1000));

    expect(await f.governor.state(p.proposalId)).to.equal(State.Executed);
    expect(await f.usdc.balanceOf(f.grantee.address)).to.equal(usdc6(1000));
    expect(await f.usdc.balanceOf(await f.treasury.getAddress())).to.equal(usdc6(20_000_000 - 1000));
  });

  it("cannot execute before the timelock delay has passed", async () => {
    const f = await loadFixture(deployDao);
    const p = await proposeGrant(f, usdc6(1000));
    await mine(2);
    await f.governor.connect(f.voterA).castVote(p.proposalId, VOTE_FOR);
    await f.governor.connect(f.voterB).castVote(p.proposalId, VOTE_FOR);
    await mine(21);
    await f.governor.queue(p.targets, p.values, p.calldatas, p.descriptionHash);

    await expect(f.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash))
      .to.be.revertedWithCustomError(f.timelock, "TimelockUnexpectedOperationState");
  });

  it("is defeated when For votes stay below the 4% quorum", async () => {
    const f = await loadFixture(deployDao);
    const p = await proposeGrant(f, usdc6(1000));
    await mine(2);
    await f.governor.connect(f.voterA).castVote(p.proposalId, VOTE_FOR); // 3M < 4M quorum
    await mine(21);
    expect(await f.governor.state(p.proposalId)).to.equal(State.Defeated);
  });

  it("rejects direct treasury calls from anyone but the timelock", async () => {
    const { treasury, usdc, outsider } = await loadFixture(deployDao);
    await expect(treasury.connect(outsider).transfer(await usdc.getAddress(), outsider.address, 1n))
      .to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount")
      .withArgs(outsider.address);
    await expect(treasury.connect(outsider).approve(await usdc.getAddress(), outsider.address, 1n))
      .to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
  });

  it("only lets the owner mint MockUSDC", async () => {
    const { usdc, outsider } = await loadFixture(deployDao);
    await expect(usdc.connect(outsider).mint(outsider.address, 1n))
      .to.be.revertedWithCustomError(usdc, "OwnableUnauthorizedAccount");
  });

  it("accepts ETH and can send it only via the timelock", async () => {
    const { treasury, timelock, deployer, grantee } = await loadFixture(deployDao);
    const treasuryAddr = await treasury.getAddress();
    await expect(deployer.sendTransaction({ to: treasuryAddr, value: ethers.parseEther("1") }))
      .to.emit(treasury, "Received")
      .withArgs(deployer.address, ethers.parseEther("1"));

    // Impersonate the timelock to check the ETH branch without a full proposal.
    const timelockAddr = await timelock.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [timelockAddr]);
    await ethers.provider.send("hardhat_setBalance", [timelockAddr, "0xDE0B6B3A7640000"]);
    const asTimelock = await ethers.getSigner(timelockAddr);
    await expect(treasury.connect(asTimelock).transfer(ethers.ZeroAddress, grantee.address, ethers.parseEther("0.4")))
      .to.changeEtherBalances([treasury, grantee], [-ethers.parseEther("0.4"), ethers.parseEther("0.4")]);
  });
});
