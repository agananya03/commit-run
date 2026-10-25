// POST /simulate against a RUNNING Hardhat node with `npm run deploy:seed` applied and an Anvil fork of it
// (`npm run node`, `npm run deploy:seed`, `npm run fork` in /contracts). Skips when any of them is missing.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv } from "ajv";
import addFormatsModule from "ajv-formats";
import { Contract, Interface, JsonRpcProvider, MaxUint256, Network } from "ethers";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ContractBook } from "../src/deployments.js";
import { rpcReachable } from "../src/rpc.js";
import type { SimulationResultT } from "../src/schema.js";
import { Simulator } from "../src/simulate.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const depFile = `${repo}contracts/deployments/localhost.json`;
const NODE = "http://127.0.0.1:8545";
const ANVIL = "http://127.0.0.1:8546";
const d = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : null;
const provider = (u: string) => {
  const p = new JsonRpcProvider(u, Network.from(31337), { staticNetwork: true });
  p.pollingInterval = 100;
  return p;
};
const ready = d && (await rpcReachable(NODE, 5000)) && (await rpcReachable(ANVIL, 5000)) && (await provider(NODE).getCode(d.contracts.MeridianGovernor.address)) !== "0x";

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const schema = JSON.parse(readFileSync(`${repo}shared/schemas/json/SimulationResult.schema.json`, "utf8"));
const validate = addFormats(new Ajv({ allErrors: true, strict: false })).compile(schema);
const mock = JSON.parse(readFileSync(`${repo}shared/mocks/simulate.MIP-21.json`, "utf8")) as SimulationResultT;

describe.skipIf(!ready)("POST /simulate (hardhat node + anvil fork)", () => {
  const c = d!.contracts;
  const sim = new Simulator({ anvil: provider(ANVIL), source: provider(NODE), rpcUrl: NODE, book: new ContractBook(d!), logger: pino({ level: "silent" }) });
  const app = createApp({ logger: pino({ level: "silent" }), forkReachable: async () => true, simulator: sim });
  const alt = "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097";
  const recipient = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // Hardhat #9, MIP-12's recipient
  const treasury = new Interface(c.Treasury.abi);
  const vault = new Interface([...c.VaultV1.abi, ...c.VaultV2.abi.filter((f: { name?: string }) => ["reinitializeV2", "migrateReserves"].includes(f.name ?? ""))]);

  const mip12 = { proposalId: "MIP-12", targets: [c.Treasury.address], values: ["0"], calldatas: [treasury.encodeFunctionData("transfer", [c.MockUSDC.address, recipient, 400_000_000_000n])] };
  const mip21 = {
    proposalId: "MIP-21",
    targets: [c.VaultProxy.address, c.Treasury.address],
    values: ["0", "0"],
    calldatas: [
      vault.encodeFunctionData("upgradeToAndCall", [c.VaultV2.address, vault.encodeFunctionData("reinitializeV2", [alt])]),
      treasury.encodeFunctionData("approve", [c.MockUSDC.address, alt, MaxUint256]),
    ],
  };

  it("MIP-12: exactly one USDC transfer treasury -> recipient with the expected amount, and nothing else", async () => {
    const res = await request(app).post("/simulate").send(mip12).expect(200);
    const r = res.body as SimulationResultT;
    expect(r.success).toBe(true);
    expect(r.tokenTransfers).toEqual([{ token: c.MockUSDC.address, from: c.Treasury.address, to: recipient, amount: "400000000000" }]);
    expect(r.approvals).toEqual([]);
    expect(r.ownershipChanges).toEqual([]);
    expect(r.implementationChanges).toEqual([]);
    expect(r.decodedCalls.map((x) => x.signature)).toEqual(["transfer(address,address,uint256)"]);
    expect(new Set(r.storageDiffs.map((s) => s.contract))).toEqual(new Set([c.MockUSDC.address])); // two balance slots, USDC only
    expect(r.storageDiffs).toHaveLength(2);
    expect(r.events.map((e) => e.name).sort()).toEqual(["Sent", "Transfer"]);
    expect(r.bytecodeHash).toBe(`0x${"0".repeat(64)}`);
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
  });

  it("MIP-21: finds the hidden owner change, unlimited approval and new selectors, matching the shared mock", async () => {
    const r = await sim.simulate(mip21);
    expect(r.success).toBe(true);
    expect(r.ownershipChanges).toEqual(mock.ownershipChanges);
    expect(r.approvals).toEqual(mock.approvals);
    expect(r.implementationChanges.map((i) => ({ ...i, addedSelectors: [...i.addedSelectors].sort((a, b) => a.selector.localeCompare(b.selector)) })))
      .toEqual(mock.implementationChanges.map((i) => ({ ...i, addedSelectors: [...i.addedSelectors].sort((a, b) => a.selector.localeCompare(b.selector)) })));
    expect(r.bytecodeHash).toBe(mock.bytecodeHash); // the real VaultV2 runtime code hash
    expect(r.decodedCalls.map((x) => `${x.contractName}.${x.signature}`)).toEqual([
      "VaultProxy.upgradeToAndCall(address,bytes)",
      "VaultV2 (delegatecall).reinitializeV2(address)",
      "Treasury.approve(address,address,uint256)",
    ]);
    // The mock's two storage diffs (EIP-1967 implementation slot, OZ owner slot) are among the real ones.
    for (const s of mock.storageDiffs) expect(r.storageDiffs).toContainEqual(s);
    expect(r.events.map((e) => e.name)).toEqual(expect.arrayContaining(["Upgraded", "OwnershipTransferred", "Initialized", "Approval"]));
    expect(r.events.some((e) => e.name.startsWith("Unlogged"))).toBe(false);
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
  });

  it("is deterministic and leaves the fork as it found it", async () => {
    const a = await sim.simulate(mip21);
    const b = await sim.simulate(mip21);
    expect(b.simHash).toBe(a.simHash);
    const vaultOnFork = new Contract(c.VaultProxy.address, ["function owner() view returns (address)"], provider(ANVIL));
    expect(await vaultOnFork.getFunction("owner")()).toBe(c.GuardedTimelock.address);
  });

  it("reports a revert with its decoded reason and no state changes (the batch is all-or-nothing)", async () => {
    const r = await sim.simulate({
      proposalId: "REVERT",
      targets: [c.Treasury.address, c.Treasury.address],
      values: ["0", "0"],
      calldatas: [treasury.encodeFunctionData("transfer", [c.MockUSDC.address, recipient, 1n]), treasury.encodeFunctionData("transfer", [c.MockUSDC.address, alt, 10n ** 18n])],
    });
    expect(r.success).toBe(false);
    expect(r.revertReason).toMatch(/^call 1: ERC20InsufficientBalance\(/);
    expect(r.tokenTransfers).toEqual([]);
    expect(r.storageDiffs).toEqual([]);
    expect(r.decodedCalls).toHaveLength(2);
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
  });

  it("pins to forkBlock: before the deploy the Treasury has no code, so nothing moves and that is reported", async () => {
    const r = await sim.simulate({ ...mip12, forkBlock: 0 });
    expect(r.success).toBe(true); // a call to an address without code succeeds on the EVM
    expect(r.tokenTransfers).toEqual([]);
    expect(r.events).toContainEqual({ contract: c.Treasury.address, name: "NoCodeAtTarget", args: { callIndex: 0 } });
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
  });
});
