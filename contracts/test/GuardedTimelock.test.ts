import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionResponse } from "ethers";

const VOTE_FOR = 1;
const MIN_DELAY = 60;
const SEVEN_DAYS = 7 * 24 * 60 * 60;
const State = { Queued: 5n, Executed: 7n } as const;
const usdc6 = (n: number): bigint => ethers.parseUnits(n.toString(), 6);
const findingsHash = ethers.id("findings:MIP-21");

async function deployGuardedDao() {
  const [deployer, watchdog, voterA, voterB, grantee, outsider] = await ethers.getSigners();

  const token = await ethers.deployContract("MeridianToken", [deployer.address]);
  const usdc = await ethers.deployContract("MockUSDC", [deployer.address]);
  const timelock = await ethers.deployContract("GuardedTimelock", [MIN_DELAY, [], [ethers.ZeroAddress], deployer.address, watchdog.address]);
  const guard = await ethers.getContractAt("GovernanceGuard", await timelock.guard());
  const governor = await ethers.deployContract("MeridianGovernor", [await token.getAddress(), await timelock.getAddress()]);
  const treasury = await ethers.deployContract("Treasury", [await timelock.getAddress()]);

  const governorAddr = await governor.getAddress();
  await timelock.grantRole(await timelock.PROPOSER_ROLE(), governorAddr);
  await timelock.grantRole(await timelock.CANCELLER_ROLE(), governorAddr);
  await timelock.renounceRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address);

  await usdc.mint(await treasury.getAddress(), usdc6(20_000_000));
  await token.transfer(voterA.address, ethers.parseEther("3000000"));
  await token.transfer(voterB.address, ethers.parseEther("2000000"));
  await token.connect(voterA).delegate(voterA.address);
  await token.connect(voterB).delegate(voterB.address);

  return { deployer, watchdog, voterA, voterB, grantee, outsider, token, usdc, timelock, guard, governor, treasury };
}

type Dao = Awaited<ReturnType<typeof deployGuardedDao>>;
interface Proposal { targets: string[]; values: bigint[]; calldatas: string[]; descriptionHash: string; proposalId: bigint }

/** propose -> vote For -> queue. Returns the proposal and the timelock operation id from CallScheduled. */
async function passAndQueue(dao: Dao, targets: string[], calldatas: string[], description: string): Promise<{ p: Proposal; operationId: string }> {
  const values = targets.map(() => 0n);
  const descriptionHash = ethers.id(description);
  await dao.governor.connect(dao.voterA).propose(targets, values, calldatas, description);
  const proposalId = await dao.governor.hashProposal(targets, values, calldatas, descriptionHash);
  await mine(2);
  await dao.governor.connect(dao.voterA).castVote(proposalId, VOTE_FOR);
  await dao.governor.connect(dao.voterB).castVote(proposalId, VOTE_FOR);
  await mine(21);
  const tx: ContractTransactionResponse = await dao.governor.queue(targets, values, calldatas, descriptionHash);
  const operationId = await scheduledOperationId(dao, tx);
  return { p: { targets, values, calldatas, descriptionHash, proposalId }, operationId };
}

/** The watchdog's view: read the operation id from the timelock's CallScheduled event. */
async function scheduledOperationId(dao: Dao, tx: ContractTransactionResponse): Promise<string> {
  const receipt = await tx.wait();
  for (const log of receipt?.logs ?? []) {
    const parsed = dao.timelock.interface.parseLog(log);
    if (parsed?.name === "CallScheduled") return parsed.args.id as string;
  }
  throw new Error("CallScheduled not emitted");
}

async function grantProposal(dao: Dao) {
  const calldata = dao.treasury.interface.encodeFunctionData("transfer", [await dao.usdc.getAddress(), dao.grantee.address, usdc6(1000)]);
  return passAndQueue(dao, [await dao.treasury.getAddress()], [calldata], "MIP-21: suspicious grant");
}

const execute = (dao: Dao, p: Proposal) => dao.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash);

describe("GovernanceGuard + GuardedTimelock", () => {
  it("wires the guard to the timelock, with governance as admin", async () => {
    const { guard, timelock, watchdog } = await loadFixture(deployGuardedDao);
    expect(await guard.timelock()).to.equal(await timelock.getAddress());
    expect(await guard.hasRole(await guard.DEFAULT_ADMIN_ROLE(), await timelock.getAddress())).to.equal(true);
    expect(await guard.hasRole(await guard.WATCHDOG_ROLE(), watchdog.address)).to.equal(true);
  });

  it("matches the operation id the backend computes off-chain", async () => {
    const dao = await loadFixture(deployGuardedDao);
    const { p, operationId } = await grantProposal(dao);
    // GovernorTimelockControl salt = bytes20(governor) ^ descriptionHash
    const salt = ethers.toBeHex((BigInt(await dao.governor.getAddress()) << 96n) ^ BigInt(p.descriptionHash), 32);
    expect(await dao.timelock.hashOperationBatch(p.targets, p.values, p.calldatas, ethers.ZeroHash, salt)).to.equal(operationId);
  });

  it("blocks execution of a flagged operation", async () => {
    const dao = await loadFixture(deployGuardedDao);
    const { p, operationId } = await grantProposal(dao);

    await expect(dao.guard.connect(dao.watchdog).flag(operationId, findingsHash))
      .to.emit(dao.guard, "Flagged")
      .withArgs(operationId, findingsHash, dao.watchdog.address);
    expect(await dao.guard.isFlagged(operationId)).to.equal(true);

    await time.increase(MIN_DELAY + 1);
    await expect(execute(dao, p)).to.be.revertedWithCustomError(dao.timelock, "GuardFlagged").withArgs(operationId);
    // Calling the timelock directly is blocked too, not just the governor path.
    const salt = ethers.toBeHex((BigInt(await dao.governor.getAddress()) << 96n) ^ BigInt(p.descriptionHash), 32);
    await expect(dao.timelock.executeBatch(p.targets, p.values, p.calldatas, ethers.ZeroHash, salt))
      .to.be.revertedWithCustomError(dao.timelock, "GuardFlagged");
    expect(await dao.governor.state(p.proposalId)).to.equal(State.Queued);
    expect(await dao.usdc.balanceOf(dao.grantee.address)).to.equal(0n);
  });

  it("executes after a governance proposal clears the flag (override by vote)", async () => {
    const dao = await loadFixture(deployGuardedDao);
    const { p, operationId } = await grantProposal(dao);
    await dao.guard.connect(dao.watchdog).flag(operationId, findingsHash);

    const clearCall = dao.guard.interface.encodeFunctionData("clear", [operationId]);
    const override = await passAndQueue(dao, [await dao.guard.getAddress()], [clearCall], "Override: clear the MIP-21 flag");
    await time.increase(MIN_DELAY + 1);
    await expect(execute(dao, override.p)).to.emit(dao.guard, "Cleared").withArgs(operationId);
    expect(await dao.guard.isFlagged(operationId)).to.equal(false);

    await execute(dao, p);
    expect(await dao.governor.state(p.proposalId)).to.equal(State.Executed);
    expect(await dao.usdc.balanceOf(dao.grantee.address)).to.equal(usdc6(1000));
    // The override is final: the watchdog cannot re-flag a cleared operation.
    await expect(dao.guard.connect(dao.watchdog).flag(operationId, findingsHash))
      .to.be.revertedWithCustomError(dao.guard, "AlreadyCleared");
  });

  it("lets a flag expire after 7 days and refuses to re-flag", async () => {
    const dao = await loadFixture(deployGuardedDao);
    const { p, operationId } = await grantProposal(dao);
    await dao.guard.connect(dao.watchdog).flag(operationId, findingsHash);

    await time.increase(SEVEN_DAYS);
    expect(await dao.guard.isFlagged(operationId)).to.equal(false);
    await expect(dao.guard.connect(dao.watchdog).flag(operationId, findingsHash))
      .to.be.revertedWithCustomError(dao.guard, "AlreadyFlagged");
    await execute(dao, p);
    expect(await dao.governor.state(p.proposalId)).to.equal(State.Executed);
  });

  it("only the watchdog can flag and only the timelock can clear", async () => {
    const dao = await loadFixture(deployGuardedDao);
    const { operationId } = await grantProposal(dao);

    await expect(dao.guard.connect(dao.outsider).flag(operationId, findingsHash))
      .to.be.revertedWithCustomError(dao.guard, "AccessControlUnauthorizedAccount")
      .withArgs(dao.outsider.address, await dao.guard.WATCHDOG_ROLE());
    await dao.guard.connect(dao.watchdog).flag(operationId, findingsHash);
    await expect(dao.guard.connect(dao.watchdog).flag(operationId, findingsHash))
      .to.be.revertedWithCustomError(dao.guard, "AlreadyFlagged");
    for (const caller of [dao.watchdog, dao.deployer, dao.outsider]) {
      await expect(dao.guard.connect(caller).clear(operationId))
        .to.be.revertedWithCustomError(dao.guard, "NotTimelock")
        .withArgs(caller.address);
    }
  });

  it("does not affect unflagged operations", async () => {
    const dao = await loadFixture(deployGuardedDao);
    const { p } = await grantProposal(dao);
    await time.increase(MIN_DELAY + 1);
    await execute(dao, p);
    expect(await dao.usdc.balanceOf(dao.grantee.address)).to.equal(usdc6(1000));
  });
});
