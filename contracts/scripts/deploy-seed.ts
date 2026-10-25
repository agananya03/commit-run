/**
 * npm run deploy:seed  (hardhat run scripts/deploy-seed.ts --network localhost)
 *
 * Deploys Meridian DAO in a fixed order from Hardhat #0 so addresses are deterministic, deploys the
 * malicious MIP-21 VaultV2 implementation from the proposer (#13), seeds MRD/USDC balances and
 * delegations, replays the wallet transfer history the COI engine reads, and writes
 * deployments/<network>.json in the shared `Deployments` shape.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifacts, ethers, network, upgrades } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MeridianToken, MockUSDC } from "../typechain-types";
import { DECIMALS, loadSeedData, type Prefunding, type SeedTransfer, type SeedWallet } from "./seed/format";

const TIMELOCK_DELAY = Number(process.env.TIMELOCK_DELAY ?? 60);
const TREASURY_USDC = ethers.parseUnits("20000000", 6);
const VAULT_RESERVES_USDC = ethers.parseUnits("8000000", 6);
const VAULT_DEPOSIT_CAP = ethers.parseUnits("50000000", 6);
const WATCHDOG_INDEX = 1;
const MIP21_PROPOSER_INDEX = 13;

interface DeployedContract { address: string; artifact: string; decimals?: number }

async function main(): Promise<void> {
  const started = Date.now();
  const signers = await ethers.getSigners();
  const [deployer] = signers;
  const watchdog = signers[WATCHDOG_INDEX];
  const mip21Proposer = signers[MIP21_PROPOSER_INDEX];
  if (!deployer || !watchdog || !mip21Proposer || signers.length < 80) {
    throw new Error(`expected 80 accounts from the default mnemonic, got ${signers.length}`);
  }
  console.log(`network ${network.name}, deployer ${deployer.address}, timelock delay ${TIMELOCK_DELAY}s`);

  // 1. Contracts, in a fixed order (addresses depend on the deployer's nonce).
  const token = await ethers.deployContract("MeridianToken", [deployer.address]);
  const deployBlock = (await token.deploymentTransaction()!.wait())!.blockNumber;
  const usdc = await ethers.deployContract("MockUSDC", [deployer.address]);
  const timelock = await ethers.deployContract("GuardedTimelock", [
    TIMELOCK_DELAY, [], [ethers.ZeroAddress], deployer.address, watchdog.address,
  ]);
  const governor = await ethers.deployContract("MeridianGovernor", [await token.getAddress(), await timelock.getAddress()]);
  const treasury = await ethers.deployContract("Treasury", [await timelock.getAddress()]);
  const vault = await upgrades.deployProxy(
    await ethers.getContractFactory("VaultV1"),
    [await usdc.getAddress(), await timelock.getAddress(), VAULT_DEPOSIT_CAP],
    { kind: "uups" },
  );
  await vault.waitForDeployment();
  const registry = await ethers.deployContract("ProposalRegistry");

  const vaultAddress = await vault.getAddress();
  const contracts: Record<string, DeployedContract> = {
    MeridianToken: { address: await token.getAddress(), artifact: "MeridianToken", decimals: 18 },
    MockUSDC: { address: await usdc.getAddress(), artifact: "MockUSDC", decimals: 6 },
    GuardedTimelock: { address: await timelock.getAddress(), artifact: "GuardedTimelock" },
    GovernanceGuard: { address: await timelock.guard(), artifact: "GovernanceGuard" },
    MeridianGovernor: { address: await governor.getAddress(), artifact: "MeridianGovernor" },
    Treasury: { address: await treasury.getAddress(), artifact: "Treasury" },
    VaultV1: { address: await upgrades.erc1967.getImplementationAddress(vaultAddress), artifact: "VaultV1" },
    VaultProxy: { address: vaultAddress, artifact: "VaultV1" },
    ProposalRegistry: { address: await registry.getAddress(), artifact: "ProposalRegistry" },
  };

  // 2. Timelock roles: only the governor proposes/cancels; anyone executes; deployer gives up admin.
  await (await timelock.grantRole(await timelock.PROPOSER_ROLE(), contracts.MeridianGovernor!.address)).wait();
  await (await timelock.grantRole(await timelock.CANCELLER_ROLE(), contracts.MeridianGovernor!.address)).wait();
  await (await timelock.renounceRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).wait();

  // 3. Funding.
  await (await usdc.mint(contracts.Treasury!.address, TREASURY_USDC)).wait();
  await (await usdc.mint(vaultAddress, VAULT_RESERVES_USDC)).wait();

  // 4. The MIP-21 malicious implementation, deployed by the proposer, checked for layout compatibility.
  const vaultV2Factory = await ethers.getContractFactory("VaultV2", mip21Proposer);
  const vaultV2 = await vaultV2Factory.deploy();
  await vaultV2.waitForDeployment();
  await upgrades.validateUpgrade(vaultAddress, vaultV2Factory, { kind: "uups" });
  contracts.VaultV2 = { address: await vaultV2.getAddress(), artifact: "VaultV2" };

  // 5. Wallet universe and transfer history.
  const seed = loadSeedData(await token.INITIAL_SUPPLY());
  if (seed.usedFallback) {
    console.warn("WARNING: /data/wallets.json or /data/transfers.json missing; using the SYNTHETIC fallback in scripts/seed/.");
  }
  console.log(`seed: ${seed.sources.wallets}\n      ${seed.sources.transfers}`);
  await seedWallets(seed.wallets, seed.prefunding, signers, token, usdc);
  const replayed = await replayTransfers(seed.transfers, signers, token, usdc);

  // 6. deployments/<network>.json (shape = Deployments in /shared/schemas/types.ts).
  const { chainId } = await ethers.provider.getNetwork();
  const out: { chainId: number; deployBlock: number; contracts: Record<string, { address: string; abi: unknown[]; decimals?: number }> } = {
    chainId: Number(chainId),
    deployBlock,
    contracts: {},
  };
  for (const [name, c] of Object.entries(contracts)) {
    const { abi } = await artifacts.readArtifact(c.artifact);
    out.contracts[name] = { address: c.address, abi, ...(c.decimals !== undefined ? { decimals: c.decimals } : {}) };
  }
  const dir = join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${network.name}.json`);
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

  console.table(Object.fromEntries(Object.entries(contracts).map(([name, c]) => [name, c.address])));
  console.log(
    `wallets ${seed.wallets.length}, transfers ${replayed}, deployBlock ${deployBlock}, ` +
      `latest block ${await ethers.provider.getBlockNumber()}, wrote ${file} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

async function seedWallets(wallets: SeedWallet[], prefunding: Prefunding, signers: HardhatEthersSigner[], token: MeridianToken, usdc: MockUSDC): Promise<void> {
  const deployer = signers[0]!;
  for (const w of wallets) {
    const account = signers[w.index]!;
    if (w.mrd > 0n && w.index !== 0) await (await token.connect(deployer).transfer(account.address, w.mrd)).wait();
    if (w.usdc > 0n) await (await usdc.connect(deployer).mint(account.address, w.usdc)).wait();
  }

  // Balances the data assumes but never creates: USDC is minted (a mint comes from 0x0, so it adds no wallet
  // link); MRD comes from the deployer, which held it back from the largest allocation.
  for (const [index, amount] of prefunding.usdc) await (await usdc.connect(deployer).mint(signers[index]!.address, amount)).wait();
  for (const [index, amount] of prefunding.mrd) await (await token.connect(deployer).transfer(signers[index]!.address, amount)).wait();
  const total = (m: Map<number, bigint>) => [...m.values()].reduce((s, x) => s + x, 0n);
  if (prefunding.usdc.size + prefunding.mrd.size > 0) {
    console.log(
      `prefunded ${prefunding.usdc.size} accounts with ${ethers.formatUnits(total(prefunding.usdc), 6)} USDC (mint) and ` +
        `${prefunding.mrd.size} with ${ethers.formatEther(total(prefunding.mrd))} MRD (from deployer` +
        `${prefunding.mrdHeldBackFrom !== null ? `, held back from #${prefunding.mrdHeldBackFrom}` : ""})`,
    );
  }

  // Delegate after all balances are in place, from each holder's own account.
  for (const w of wallets) {
    if (w.mrd === 0n && w.delegateTo === undefined) continue;
    const delegatee = signers[w.delegateTo ?? w.index]!;
    await (await token.connect(signers[w.index]!).delegate(delegatee.address)).wait();
  }
}

/** Transfers arrive sorted in replay order (blockOffset, then file position). */
async function replayTransfers(ordered: SeedTransfer[], signers: HardhatEthersSigner[], token: MeridianToken, usdc: MockUSDC): Promise<number> {
  const startBlock = await ethers.provider.getBlockNumber();

  for (const t of ordered) {
    const from = signers[t.from]!;
    const to = signers[t.to]!;
    const label = `transfer ${t.id ?? `#${t.i}`} (${ethers.formatUnits(t.amount, DECIMALS[t.token])} ${t.token} from #${t.from} to #${t.to})`;

    // Each tx is mined in the next block, so mine empty blocks until that block is startBlock + blockOffset.
    const current = await ethers.provider.getBlockNumber();
    const gap = startBlock + t.blockOffset - current - 1;
    if (gap > 0) await mine(gap);

    if (t.timestamp) {
      const at = Math.floor(Date.parse(t.timestamp) / 1000);
      const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
      if (at <= latest) {
        throw new Error(`${label}: timestamp ${t.timestamp} is not after the latest block (${new Date(latest * 1000).toISOString()}); start the node with CHAIN_START_DATE earlier`);
      }
      await ethers.provider.send("evm_setNextBlockTimestamp", [at]);
    }

    if (t.token === "ETH") {
      const balance = await ethers.provider.getBalance(from.address);
      if (balance < t.amount) throw new Error(`${label}: account has ${ethers.formatEther(balance)} ETH`);
      await (await from.sendTransaction({ to: to.address, value: t.amount })).wait();
    } else {
      const erc20 = t.token === "USDC" ? usdc : token;
      const balance = await erc20.balanceOf(from.address);
      // planPrefunding() already covered every shortfall, so this only fires on a bug.
      if (balance < t.amount) throw new Error(`${label}: account has ${ethers.formatUnits(balance, DECIMALS[t.token])} ${t.token}`);
      await (await erc20.connect(from).transfer(to.address, t.amount)).wait();
    }
  }
  return ordered.length;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
