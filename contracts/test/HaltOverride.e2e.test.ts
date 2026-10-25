import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers, upgrades } from "hardhat";
import { loadFixture, mine, time } from "@nomicfoundation/hardhat-network-helpers";
import type { ContractTransactionResponse } from "ethers";
import { encodeActions, hardhatAddress, type Action, type Deployments } from "../scripts/lib/actions";
import { governorSalt, overrideProposal } from "../scripts/lib/override";

// End to end with the real MIP-21 payload from /data: pass -> queue -> watchdog flags -> execution blocked ->
// token holders override by vote -> MIP-21 executes after all (proving the override is real power, not a no-op).

const MIN_DELAY = 60; // seconds, as deployed for the demo: the backend's simulate + flag budget
const State = { Queued: 5n, Executed: 7n } as const;
const VOTE_FOR = 1;
const ALT_WALLET = hardhatAddress(14); // MIP-21's hidden beneficiary

async function deployMeridian() {
  const signers = await ethers.getSigners();
  const [deployer, watchdog] = signers;
  const proposer = signers[13]!; // MIP-21's proposer
  const voterA = signers[2]!;
  const voterB = signers[3]!;

  const token = await ethers.deployContract("MeridianToken", [deployer!.address]);
  const usdc = await ethers.deployContract("MockUSDC", [deployer!.address]);
  const timelock = await ethers.deployContract("GuardedTimelock", [MIN_DELAY, [], [ethers.ZeroAddress], deployer!.address, watchdog!.address]);
  const guard = await ethers.getContractAt("GovernanceGuard", await timelock.guard());
  const governor = await ethers.deployContract("MeridianGovernor", [await token.getAddress(), await timelock.getAddress()]);
  const treasury = await ethers.deployContract("Treasury", [await timelock.getAddress()]);
  const vault = await upgrades.deployProxy(await ethers.getContractFactory("VaultV1"), [await usdc.getAddress(), await timelock.getAddress(), ethers.parseUnits("50000000", 6)], { kind: "uups" });
  const vaultV2 = await ethers.deployContract("VaultV2", [], proposer);

  await timelock.grantRole(await timelock.PROPOSER_ROLE(), await governor.getAddress());
  await timelock.grantRole(await timelock.CANCELLER_ROLE(), await governor.getAddress());
  await timelock.renounceRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer!.address);

  await usdc.mint(await treasury.getAddress(), ethers.parseUnits("20000000", 6));
  await usdc.mint(await vault.getAddress(), ethers.parseUnits("8000000", 6));
  for (const [voter, amount] of [[voterA, "3000000"], [voterB, "2000000"]] as const) {
    await token.transfer(voter.address, ethers.parseEther(amount));
    await token.connect(voter).delegate(voter.address);
  }

  const abi = async (name: string) => JSON.parse((await ethers.getContractFactory(name)).interface.formatJson()) as unknown[];
  const deployments: Deployments = {
    chainId: 31337,
    deployBlock: 0,
    contracts: {
      MockUSDC: { address: await usdc.getAddress(), abi: await abi("MockUSDC") },
      Treasury: { address: await treasury.getAddress(), abi: await abi("Treasury") },
      VaultProxy: { address: await vault.getAddress(), abi: await abi("VaultV1") },
      VaultV2: { address: await vaultV2.getAddress(), abi: await abi("VaultV2") },
    },
  };
  return { watchdog: watchdog!, proposer, voterA, voterB, usdc, timelock, guard, governor, treasury, vault, deployments };
}

type Dao = Awaited<ReturnType<typeof deployMeridian>>;

async function passAndQueue(dao: Dao, p: { targets: string[]; values: bigint[]; calldatas: string[]; description: string }) {
  const descriptionHash = ethers.id(p.description);
  await dao.governor.connect(dao.proposer).propose(p.targets, p.values, p.calldatas, p.description);
  const proposalId = await dao.governor.hashProposal(p.targets, p.values, p.calldatas, descriptionHash);
  await mine(2);
  await dao.governor.connect(dao.voterA).castVote(proposalId, VOTE_FOR);
  await dao.governor.connect(dao.voterB).castVote(proposalId, VOTE_FOR);
  await mine(21);
  const tx: ContractTransactionResponse = await dao.governor.queue(p.targets, p.values, p.calldatas, descriptionHash);
  const receipt = await tx.wait();
  const scheduled = receipt!.logs.map((l) => dao.timelock.interface.parseLog(l)).find((e) => e?.name === "CallScheduled");
  return { ...p, descriptionHash, proposalId, operationId: scheduled!.args.id as string, queuedAt: (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp };
}

const execute = (dao: Dao, p: { targets: string[]; values: bigint[]; calldatas: string[]; descriptionHash: string }) => dao.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash);

async function mip21(dao: Dao) {
  const actions = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "scenarios", "MIP-21", "onchain_actions.json"), "utf8")) as Action[];
  const encoded = encodeActions(actions, dao.deployments);
  return passAndQueue(dao, { ...encoded, description: "# MIP-21: VaultV2 storage packing and gas optimisation" });
}

describe("MIP-21 end to end: watchdog halt and governance override", () => {
  it("leaves the watchdog the whole 60 s delay: queued, not executable before it", async () => {
    const dao = await loadFixture(deployMeridian);
    const p = await mip21(dao);
    expect(await dao.timelock.getMinDelay()).to.equal(BigInt(MIN_DELAY));
    expect(await dao.governor.state(p.proposalId)).to.equal(State.Queued);
    expect(await dao.timelock.isOperationReady(p.operationId)).to.equal(false);
    await expect(execute(dao, p)).to.be.revertedWithCustomError(dao.timelock, "TimelockUnexpectedOperationState");
    // The operation id is reproducible off-chain (what the backend's listener computes at ProposalCreated)
    const salt = governorSalt(await dao.governor.getAddress(), p.descriptionHash);
    expect(await dao.timelock.hashOperationBatch(p.targets, p.values, p.calldatas, ethers.ZeroHash, salt)).to.equal(p.operationId);
  });

  it("watchdog (#1) flags within the delay; execute reverts with GuardFlagged and nothing changes", async () => {
    const dao = await loadFixture(deployMeridian);
    const p = await mip21(dao);
    const findingsHash = ethers.id("findings:MIP-21");

    await time.increase(30); // the backend simulates and decides mid-delay
    await expect(dao.guard.connect(dao.watchdog).flag(p.operationId, findingsHash))
      .to.emit(dao.guard, "Flagged")
      .withArgs(p.operationId, findingsHash, dao.watchdog.address);
    expect(await time.latest()).to.be.lessThan(p.queuedAt + MIN_DELAY);

    await time.increase(MIN_DELAY);
    expect(await dao.timelock.isOperationReady(p.operationId)).to.equal(true); // the delay is over...
    await expect(execute(dao, p)).to.be.revertedWithCustomError(dao.timelock, "GuardFlagged").withArgs(p.operationId); // ...but it is halted

    expect(await dao.governor.state(p.proposalId)).to.equal(State.Queued);
    expect(await dao.vault.owner()).to.equal(await dao.timelock.getAddress());
    expect(await dao.usdc.allowance(await dao.treasury.getAddress(), ALT_WALLET)).to.equal(0n);
  });

  it("token holders override the flag by vote (guard.clear), and then MIP-21 executes", async () => {
    const dao = await loadFixture(deployMeridian);
    const p = await mip21(dao);
    await dao.guard.connect(dao.watchdog).flag(p.operationId, ethers.id("findings:MIP-21"));

    const o = await passAndQueue(dao, overrideProposal(await dao.guard.getAddress(), p.operationId, "MIP-21"));
    expect(o.description).to.not.match(/MIP-21/); // must not be linked to MIP-21 by the backend
    await time.increase(MIN_DELAY + 1);
    await expect(execute(dao, o)).to.emit(dao.guard, "Cleared").withArgs(p.operationId);
    expect(await dao.guard.isFlagged(p.operationId)).to.equal(false);

    await expect(execute(dao, p)).to.emit(dao.vault, "OwnershipTransferred");
    expect(await dao.governor.state(p.proposalId)).to.equal(State.Executed);
    expect(await dao.vault.owner()).to.equal(ALT_WALLET);
    expect(await dao.usdc.allowance(await dao.treasury.getAddress(), ALT_WALLET)).to.equal(ethers.MaxUint256);
  });

  it("the override is final: a cleared operation cannot be flagged again, and only the timelock can clear", async () => {
    const dao = await loadFixture(deployMeridian);
    const p = await mip21(dao);
    await dao.guard.connect(dao.watchdog).flag(p.operationId, ethers.id("findings:MIP-21"));
    await expect(dao.guard.connect(dao.watchdog).clear(p.operationId)).to.be.revertedWithCustomError(dao.guard, "NotTimelock");

    const o = await passAndQueue(dao, overrideProposal(await dao.guard.getAddress(), p.operationId, "MIP-21"));
    await time.increase(MIN_DELAY + 1);
    await execute(dao, o);
    await expect(dao.guard.connect(dao.watchdog).flag(p.operationId, ethers.id("again"))).to.be.revertedWithCustomError(dao.guard, "AlreadyCleared");
  });
});
