import { expect } from "chai";
import { ethers } from "ethers";
import { planPrefunding, shortfalls, type SeedTransfer, type SeedWallet } from "../scripts/seed/format";

const mrd = (n: number): bigint => ethers.parseEther(String(n));
const usdc = (n: number): bigint => ethers.parseUnits(String(n), 6);
let seq = 0;
const tx = (from: number, to: number, token: SeedTransfer["token"], amount: bigint): SeedTransfer => ({ i: seq, from, to, token, amount, blockOffset: seq++ });

describe("seed pre-funding", () => {
  it("finds what a sender is missing at the moment it sends, in replay order", () => {
    const wallets: SeedWallet[] = [{ index: 2, role: "holder", mrd: mrd(100), usdc: 0n }];
    const transfers = [tx(2, 3, "MRD", mrd(150)), tx(4, 5, "USDC", usdc(10)), tx(3, 4, "MRD", mrd(150))];
    const s = shortfalls(wallets, transfers);
    expect(s.MRD.get(2)).to.equal(mrd(50));
    expect(s.USDC.get(4)).to.equal(usdc(10));
    expect(s.MRD.has(3)).to.equal(false); // #3 received 150 first
  });

  it("mints USDC shortfalls and covers MRD from spare supply when there is some", () => {
    const wallets: SeedWallet[] = [{ index: 2, role: "holder", mrd: mrd(100), usdc: 0n }];
    const plan = planPrefunding(wallets, [tx(9, 2, "USDC", usdc(5)), tx(9, 2, "MRD", mrd(7))], mrd(1000));
    expect(plan.usdc.get(9)).to.equal(usdc(5));
    expect(plan.mrd.get(9)).to.equal(mrd(7));
    expect(plan.mrdHeldBackFrom).to.equal(null);
    expect(wallets[0]!.mrd).to.equal(mrd(100));
  });

  it("holds MRD back from the largest allocation when the whole supply is handed out", () => {
    const wallets: SeedWallet[] = [
      { index: 2, role: "holder", mrd: mrd(300), usdc: 0n },
      { index: 3, role: "whale", mrd: mrd(700), usdc: 0n },
    ];
    const plan = planPrefunding(wallets, [tx(15, 2, "MRD", mrd(40))], mrd(1000));
    expect(plan.mrd.get(15)).to.equal(mrd(40));
    expect(plan.mrdHeldBackFrom).to.equal(3);
    expect(wallets.find((w) => w.index === 3)!.mrd).to.equal(mrd(660));
  });

  it("refuses data that sends more ETH than an account can hold", () => {
    expect(() => planPrefunding([], [tx(5, 6, "ETH", ethers.parseEther("20000"))], mrd(1000))).to.throw(/ETH/);
  });
});
