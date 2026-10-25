import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { VaultV1 } from "../typechain-types";

const usdc6 = (n: number): bigint => ethers.parseUnits(n.toString(), 6);
const CAP = usdc6(50_000_000);
const RESERVES = usdc6(8_000_000);
// ERC-7201 base slot of erc7201:meridian.vault.v1; fields: +3 depositCap, +4 lastRebalance
const V1_BASE = 0xe59881199c270bc43064570d90300f5496dbc57b99f5b5c465c11a84618b0900n;

async function deployVault() {
  // `owner` stands in for the timelock; the real deploy passes the GuardedTimelock address.
  const [deployer, owner, alice, bob, carol, alt] = await ethers.getSigners();
  const usdc = await ethers.deployContract("MockUSDC", [deployer.address]);
  const VaultV1 = await ethers.getContractFactory("VaultV1");
  const proxy = await upgrades.deployProxy(VaultV1, [await usdc.getAddress(), owner.address, CAP], { kind: "uups" });
  const vault = proxy as unknown as VaultV1;
  const vaultAddr = await vault.getAddress();

  await usdc.mint(vaultAddr, RESERVES);
  for (const user of [alice, bob, carol]) {
    await usdc.mint(user.address, usdc6(100_000));
    await usdc.connect(user).approve(vaultAddr, ethers.MaxUint256);
  }
  await vault.connect(alice).deposit(usdc6(10_000)); // warm-up so later deposits are comparable

  const v2 = await ethers.deployContract("VaultV2");
  const v2Honest = await ethers.deployContract("VaultV2Honest");
  return { deployer, owner, alice, bob, carol, alt, usdc, vault, vaultAddr, v2, v2Honest, VaultV1 };
}

type Fixture = Awaited<ReturnType<typeof deployVault>>;

async function upgradeHonest(f: Fixture) {
  const data = f.v2Honest.interface.encodeFunctionData("reinitializeV2");
  await f.vault.connect(f.owner).upgradeToAndCall(await f.v2Honest.getAddress(), data);
  return ethers.getContractAt("VaultV2Honest", f.vaultAddr);
}

async function depositGas(vault: VaultV1, user: Fixture["bob"], amount: bigint): Promise<bigint> {
  const receipt = await (await vault.connect(user).deposit(amount)).wait();
  return receipt!.gasUsed;
}

describe("VaultV1", () => {
  it("initializes behind a UUPS proxy and locks the implementation", async () => {
    const { vault, owner, usdc, VaultV1 } = await loadFixture(deployVault);
    expect(await vault.owner()).to.equal(owner.address);
    expect(await vault.asset()).to.equal(await usdc.getAddress());
    expect(await vault.depositCap()).to.equal(CAP);
    expect(await vault.version()).to.equal("1.0.0");

    const impl = VaultV1.attach(await upgrades.erc1967.getImplementationAddress(await vault.getAddress())) as VaultV1;
    await expect(impl.initialize(await usdc.getAddress(), owner.address, CAP)).to.be.revertedWithCustomError(impl, "InvalidInitialization");
  });

  it("tracks deposits, withdrawals and reserves", async () => {
    const { vault, alice, usdc } = await loadFixture(deployVault);
    await expect(vault.connect(alice).withdraw(usdc6(4_000)))
      .to.emit(vault, "Withdrawn")
      .withArgs(alice.address, usdc6(4_000));
    expect(await vault.balanceOf(alice.address)).to.equal(usdc6(6_000));
    expect(await vault.totalDeposits()).to.equal(usdc6(6_000));
    expect(await vault.reserves()).to.equal(RESERVES + usdc6(6_000));
    expect(await usdc.balanceOf(alice.address)).to.equal(usdc6(94_000));
    expect(await vault.lastRebalance()).to.be.greaterThan(0n);
  });

  it("enforces the cap, balances and non-zero amounts", async () => {
    const { vault, alice, bob, owner } = await loadFixture(deployVault);
    await vault.connect(owner).setDepositCap(usdc6(15_000));
    await expect(vault.connect(bob).deposit(usdc6(5_001)))
      .to.be.revertedWithCustomError(vault, "DepositCapExceeded")
      .withArgs(usdc6(15_000), usdc6(15_001));
    await expect(vault.connect(alice).withdraw(usdc6(10_001)))
      .to.be.revertedWithCustomError(vault, "InsufficientBalance")
      .withArgs(usdc6(10_000), usdc6(10_001));
    await expect(vault.connect(alice).deposit(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("only lets the owner upgrade or change the cap", async () => {
    const { vault, alice, v2Honest } = await loadFixture(deployVault);
    const data = v2Honest.interface.encodeFunctionData("reinitializeV2");
    await expect(vault.connect(alice).upgradeToAndCall(await v2Honest.getAddress(), data))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
      .withArgs(alice.address);
    await expect(vault.connect(alice).setDepositCap(1n)).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });
});

describe("VaultV2Honest (what MIP-21 claims)", () => {
  it("keeps the owner and balances and migrates into the packed slot", async () => {
    const f = await loadFixture(deployVault);
    const lastBefore = await f.vault.lastRebalance();
    const vault = await upgradeHonest(f);

    expect(await vault.owner()).to.equal(f.owner.address);
    expect(await vault.version()).to.equal("2.0.0");
    expect(await vault.balanceOf(f.alice.address)).to.equal(usdc6(10_000));
    expect(await vault.totalDeposits()).to.equal(usdc6(10_000));
    expect(await vault.depositCap()).to.equal(CAP);
    expect(await vault.lastRebalance()).to.equal(lastBefore);
    // Old V1 slots are zeroed after the migration.
    expect(await ethers.provider.getStorage(f.vaultAddr, V1_BASE + 3n)).to.equal(ethers.ZeroHash);
    expect(await ethers.provider.getStorage(f.vaultAddr, V1_BASE + 4n)).to.equal(ethers.ZeroHash);
  });

  it("makes deposits cheaper (the gas optimisation is real)", async () => {
    const f = await loadFixture(deployVault);
    const v1Gas = await depositGas(f.vault, f.bob, usdc6(1_000));
    await upgradeHonest(f);
    const v2Gas = await depositGas(f.vault, f.carol, usdc6(1_000));
    expect(v2Gas).to.be.lessThan(v1Gas);
  });

  it("cannot be reinitialized twice", async () => {
    const f = await loadFixture(deployVault);
    const vault = await upgradeHonest(f);
    await expect(vault.reinitializeV2()).to.be.revertedWithCustomError(vault, "InvalidInitialization");
  });
});

describe("VaultV2 (the malicious MIP-21 upgrade)", () => {
  it("hands ownership to the alt wallet inside the 'storage migration'", async () => {
    const f = await loadFixture(deployVault);
    const data = f.v2.interface.encodeFunctionData("reinitializeV2", [f.alt.address]);
    await expect(f.vault.connect(f.owner).upgradeToAndCall(await f.v2.getAddress(), data))
      .to.emit(f.vault, "OwnershipTransferred")
      .withArgs(f.owner.address, f.alt.address);

    const vault = await ethers.getContractAt("VaultV2", f.vaultAddr);
    expect(await vault.owner()).to.equal(f.alt.address);
    expect(await vault.depositCap()).to.equal(CAP); // the cover story still works
    await expect(vault.reinitializeV2(f.alice.address)).to.be.revertedWithCustomError(vault, "InvalidInitialization");
  });

  it("lets the new owner drain every USDC, user deposits included", async () => {
    const f = await loadFixture(deployVault);
    const data = f.v2.interface.encodeFunctionData("reinitializeV2", [f.alt.address]);
    await f.vault.connect(f.owner).upgradeToAndCall(await f.v2.getAddress(), data);
    const vault = await ethers.getContractAt("VaultV2", f.vaultAddr);

    await expect(vault.connect(f.owner).migrateReserves(f.owner.address))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    await expect(vault.connect(f.alt).migrateReserves(f.alt.address))
      .to.changeTokenBalances(f.usdc, [f.vaultAddr, f.alt.address], [-(RESERVES + usdc6(10_000)), RESERVES + usdc6(10_000)]);
    // Alice's ledger balance is still 10k but the USDC is gone.
    expect(await vault.balanceOf(f.alice.address)).to.equal(usdc6(10_000));
    await expect(vault.connect(f.alice).withdraw(usdc6(10_000))).to.be.revertedWithCustomError(f.usdc, "ERC20InsufficientBalance");
  });
});

describe("upgrade safety (OpenZeppelin validation)", () => {
  it("accepts both V2 implementations as layout-compatible upgrades", async () => {
    const f = await loadFixture(deployVault);
    for (const name of ["VaultV2", "VaultV2Honest"]) {
      const factory = await ethers.getContractFactory(name);
      await upgrades.validateUpgrade(f.VaultV1, factory, { kind: "uups" });
      await upgrades.validateUpgrade(f.vaultAddr, factory, { kind: "uups" });
    }
  });
});
