import { HDNodeWallet, Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { disclosureMessage, parseDisclosure, recoverDisclosureSigner } from "../src/coi/disclosure.js";
import { COI_CONFIG, combinePCoi, computeCoi, pLinkOf, type CoiInput, type TransferEdge } from "../src/coi/graph.js";
import { targetsOf, topVoters } from "../src/coi/service.js";

// Readable fake addresses: 0x<letter repeated 40 times>
const A = (c: string) => `0x${c.repeat(40)}`;
const PROPOSER = A("a");
const MIDDLE = A("b");
const RECIPIENT = A("c");
const HUB = A("d");
const STRANGER = A("e");
const FUNDER = A("f");

const eth = (from: string, to: string, blockNumber: number, amount = "1000000000000000000"): TransferEdge => ({ from, to, token: null, amount, blockNumber });

const base = (over: Partial<CoiInput>): CoiInput => ({
  proposalId: "MIP-99",
  proposer: PROPOSER,
  claimed: [],
  signatureValid: false,
  targets: [{ address: RECIPIENT, role: "recipient" }],
  transfers: [],
  referenceBlock: 2000,
  ...over,
});

describe("pLink", () => {
  it("is ~0.92 for a 2-hop, recent, undisclosed path where the proposer is the first funder", () => {
    // proposer -> middle (middle's first ever funding) -> recipient, both 10 days before the proposal
    const report = computeCoi(base({ transfers: [eth(PROPOSER, MIDDLE, 1000), eth(MIDDLE, RECIPIENT, 1010)] }));
    const [link] = report.undisclosedLinks;
    expect(link).toMatchObject({ from: PROPOSER, to: RECIPIENT, path: [PROPOSER, MIDDLE, RECIPIENT], hops: 2 });
    // sigmoid(2.0 + 1.5 + 1.0 + 1.0 - 3.0) = sigmoid(2.5)
    expect(link!.pLink).toBeCloseTo(0.9241, 3);
    expect(report.pCoi).toBeCloseTo(0.9241, 3);
    expect(link!.reasons.join(" | ")).toMatch(/2-hop transfer path.*first funder.*10 days before the proposal.*not covered by a validly signed disclosure/);
  });

  it("drops the recent-funding term for old transfers", () => {
    // 49 days before a proposal at block 5000 (30 days = 3000 blocks)
    const report = computeCoi(base({ referenceBlock: 5000, transfers: [eth(PROPOSER, MIDDLE, 100), eth(MIDDLE, RECIPIENT, 110)] }));
    expect(report.undisclosedLinks[0]!.pLink).toBeCloseTo(1 / (1 + Math.exp(-1.5)), 3);
  });

  it("finds the path in the reverse direction too", () => {
    const report = computeCoi(base({ transfers: [eth(RECIPIENT, MIDDLE, 1000), eth(MIDDLE, PROPOSER, 1010)] }));
    expect(report.undisclosedLinks[0]!.path).toEqual([RECIPIENT, MIDDLE, PROPOSER]);
  });

  it("ignores paths longer than maxHops", () => {
    const chain = [PROPOSER, A("1"), A("2"), A("3"), RECIPIENT];
    const transfers = chain.slice(0, -1).map((from, i) => eth(from, chain[i + 1]!, 1000 + i));
    expect(computeCoi(base({ transfers })).undisclosedLinks).toEqual([]);
  });

  it("routes around hubs, and penalises a path that can only go through one", () => {
    // HUB pays 31 distinct wallets, so it is a hub (degree > 30)
    const fanOut = Array.from({ length: 31 }, (_, i) => eth(HUB, `0x${(i + 1).toString(16).padStart(40, "0")}`, 10 + i));
    const report = computeCoi(base({ transfers: [...fanOut, eth(PROPOSER, HUB, 1000), eth(HUB, RECIPIENT, 1010)] }));
    const link = report.undisclosedLinks[0]!;
    expect(link.path).toEqual([PROPOSER, HUB, RECIPIENT]);
    expect(link.reasons.some((r) => r.includes("hub"))).toBe(true);
    // the proposer first funded the hub and the hub first funded the recipient: neither counts
    expect(link.pLink).toBeCloseTo(pLinkOf({ pathExists: 1, firstFunderOnPath: 0, recentFunding: 1, undisclosed: 1, sharedFunder: 0, throughHub: 1 }), 4);
  });

  it("scores a shared funder without any path", () => {
    const report = computeCoi(base({ transfers: [eth(FUNDER, PROPOSER, 500), eth(FUNDER, RECIPIENT, 1200)] }));
    const link = report.undisclosedLinks[0]!;
    expect(link.path).toEqual([PROPOSER, FUNDER, RECIPIENT]);
    expect(link.pLink).toBeCloseTo(pLinkOf({ pathExists: 0, firstFunderOnPath: 0, recentFunding: 0, undisclosed: 1, sharedFunder: 1, throughHub: 0 }), 4);
  });

  it("skips targets the proposer disclosed with a valid signature, but not unsigned claims", () => {
    const transfers = [eth(PROPOSER, RECIPIENT, 1500)];
    expect(computeCoi(base({ transfers, claimed: [RECIPIENT], signatureValid: true })).undisclosedLinks).toEqual([]);
    expect(computeCoi(base({ transfers, claimed: [RECIPIENT], signatureValid: false })).undisclosedLinks).toHaveLength(1);
  });

  it("never routes through ignored addresses (zero address, protocol contracts)", () => {
    const transfers = [eth(PROPOSER, STRANGER, 1000), eth(STRANGER, RECIPIENT, 1010)];
    expect(computeCoi(base({ transfers, ignore: [STRANGER] })).undisclosedLinks).toEqual([]);
  });

  it("combines the top links into pCoi", () => {
    expect(combinePCoi([0.5, 0.5])).toBeCloseTo(0.75);
    expect(combinePCoi([0.9, 0.1, 0.1, 0.1, 0.1, 0.99], COI_CONFIG.topLinks)).toBeCloseTo(1 - 0.01 * 0.1 * 0.9 ** 3, 6);
  });

  it("is deterministic", () => {
    const input = base({ transfers: [eth(PROPOSER, MIDDLE, 1000), eth(MIDDLE, RECIPIENT, 1010), eth(PROPOSER, A("9"), 1000), eth(A("9"), RECIPIENT, 1011)] });
    expect(computeCoi(input)).toEqual(computeCoi({ ...input, transfers: [...input.transfers].reverse() }));
  });
});

describe("targets", () => {
  it("collects recipients, spenders, new owners and top voters", () => {
    const targets = targetsOf(
      { proposalId: "MIP-99", summary: "", actions: [{ kind: "transfer", recipient: RECIPIENT, description: "", citations: [] }], explicitlyExcluded: [], confidence: 1 },
      {
        proposalId: "MIP-99", success: true, decodedCalls: [], tokenTransfers: [{ token: "USDC", from: A("9"), to: MIDDLE, amount: "1" }],
        approvals: [{ token: "USDC", owner: A("9"), spender: HUB, amount: "1" }], ownershipChanges: [{ contract: "Vault", role: "owner", before: A("9"), after: STRANGER }],
        implementationChanges: [], storageDiffs: [], events: [], bytecodeHash: "0x", simHash: "0x",
      },
    );
    expect(targets.map((t) => [t.address, t.role])).toEqual([[RECIPIENT, "recipient"], [MIDDLE, "recipient"], [HUB, "spender"], [STRANGER, "new owner"]]);
    expect(topVoters([{ args: { voter: A("1"), weight: "5" } }, { args: { voter: A("2"), weight: "9" } }, { args: { voter: A("1"), weight: "1" } }], 1)).toEqual([A("2")]);
  });
});

describe("disclosure signatures", () => {
  const proposer = HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/13");
  const wallets = [RECIPIENT, PROPOSER.toUpperCase().replace("0X", "0x")];
  const statement = "I disclose these wallets.";

  it("signs canonical JSON with sorted, lowercased wallets", () => {
    expect(disclosureMessage("MIP-21", wallets, statement)).toBe(`{"proposalSlug":"MIP-21","statement":"I disclose these wallets.","wallets":["${PROPOSER}","${RECIPIENT}"]}`);
  });

  it("verifies the proposer's EIP-191 signature and rejects anyone else's", async () => {
    const signature = await proposer.signMessage(disclosureMessage("MIP-21", wallets, statement));
    expect(recoverDisclosureSigner("MIP-21", { wallets, statement, signature })).toBe(proposer.address.toLowerCase());
    const file = { proposalSlug: "MIP-21", proposer: proposer.address, wallets, statement, signature };
    expect(parseDisclosure(file, "MIP-21", proposer.address).signatureValid).toBe(true);
    expect(parseDisclosure(file, "MIP-17", proposer.address)).toMatchObject({ signatureValid: false });
    expect(parseDisclosure({ ...file, statement: "edited" }, "MIP-21", proposer.address).signatureValid).toBe(false);
    const other = await Wallet.createRandom().signMessage(disclosureMessage("MIP-21", wallets, statement));
    expect(parseDisclosure({ ...file, signature: other }, "MIP-21", proposer.address)).toMatchObject({ signatureValid: false });
  });

  it("reads D's unsigned index format as unsigned", () => {
    const parsed = parseDisclosure({ proposerIndex: 13, walletIndices: [13], statement: "only 13" }, "MIP-21", proposer.address);
    expect(parsed).toMatchObject({ wallets: [proposer.address.toLowerCase()], signatureValid: false });
  });
});
