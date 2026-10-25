// ChainListener + importTransfers against a RUNNING Hardhat node with `npm run deploy:seed` applied (contracts
// Timeouts scale with the chain: a full backfill reads every block (~11 ms each on a busy Hardhat node).
// at the addresses in contracts/deployments/localhost.json) and the docker Postgres. Drives a real governance
// flow (commit -> propose -> vote -> queue -> watchdog flag) and checks the listener links and updates the
// proposal. Skips when the node, the deployment or the database is missing.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, HDNodeWallet, JsonRpcProvider, keccak256, Network, NonceManager, toUtf8Bytes, Wallet, ZeroHash } from "ethers";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChainEvent } from "../../shared/schemas/types.js";
import { encodeActions } from "../src/chain/actions.js";
import type { DeploymentsT } from "../src/chain/contracts.js";
import { ChainListener } from "../src/chain/listener.js";
import { rpcReachable } from "../src/chain/provider.js";
import { createDb, dbReachable } from "../src/db.js";
import type { EventBus } from "../src/events.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { ProposalService } from "../src/proposals/service.js";
import { hardhatAddress } from "../src/seed/scenarios.js";

loadRootEnv();
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const depFile = join(repoRoot, "contracts", "deployments", "localhost.json");
const provider = new JsonRpcProvider(RPC, Network.from(31337), { staticNetwork: true });
provider.pollingInterval = 100;
const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
const deployments: DeploymentsT | null = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : null;
const deployed = deployments && (await rpcReachable(provider, 5000)) ? (await provider.getCode(deployments.contracts.MeridianGovernor!.address)) !== "0x" : false;
const online = deployed && (db ? await dbReachable(db) : false);

const SLUG = "MIP-9951";
const dataDir = fileURLToPath(new URL("./fixtures-api", import.meta.url));
const uploadDir = mkdtempSync(join(tmpdir(), "poi-listener-"));
const live: ChainEvent[] = [];
const bus: EventBus = { emit: (e, p) => void (e === "chain:event" && live.push(p as ChainEvent)) };
const key = (i: number) => HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, `m/44'/60'/0'/0/${i}`).privateKey;
const signer = (i: number) => new NonceManager(new Wallet(key(i), provider));
const at = (name: string, i: number) => new Contract(deployments!.contracts[name]!.address, deployments!.contracts[name]!.abi as never, signer(i));
const mine = (n: number) => provider.send("hardhat_mine", [`0x${n.toString(16)}`]);

let listener: ChainListener;

describe.skipIf(!online)("ChainListener (hardhat node + deploy:seed)", () => {
  beforeAll(async () => {
    await db!.chainEvent.deleteMany({ where: { proposal: { slug: SLUG } } });
    await db!.proposal.deleteMany({ where: { slug: SLUG } });
    await new ProposalService({ db: db!, dataDir, uploadDir, repoRoot }).createFromScenario(SLUG);
    listener = new ChainListener({ db: db!, provider, deployments: deployments!, bus, logger: pino({ level: "silent" }) });
  });

  afterAll(async () => {
    await db?.chainEvent.deleteMany({ where: { proposal: { slug: SLUG } } });
    await db?.proposal.deleteMany({ where: { slug: SLUG } });
    await db?.$disconnect();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("backfills transfers from block 0, including D's hidden COI links", { timeout: 120_000 }, async () => {
    const range = await listener.tick();
    expect(range?.from).toBe(0);
    const eth = (from: number, to: number) => db!.transfer.findMany({ where: { token: null, from: hardhatAddress(from).toLowerCase(), to: hardhatAddress(to).toLowerCase() } });
    expect((await eth(10, 11)).map((t) => t.amount.toString())).toContain("25000000000000000000"); // MIP-17: proposer -> intermediary
    expect(await eth(11, 12)).not.toHaveLength(0); //                                             intermediary -> recipient
    expect(await eth(13, 14)).not.toHaveLength(0); //                                             MIP-21: proposer -> alt wallet
    const usdc = deployments!.contracts.MockUSDC!.address.toLowerCase();
    const treasury = deployments!.contracts.Treasury!.address.toLowerCase();
    const mint = await db!.transfer.findFirst({ where: { token: usdc, from: "0x0000000000000000000000000000000000000000", to: treasury } });
    expect(mint?.amount.toString()).toBe("20000000000000"); // 20M USDC minted to the Treasury at deploy
    expect(live).toHaveLength(0); // backfill is stored, not broadcast
  });

  it("is idempotent: re-importing the same blocks adds nothing", async () => {
    const before = await db!.transfer.count();
    const { importTransfers } = await import("../src/chain/transfers.js");
    const again = await importTransfers(db!, provider, deployments!, 0, await provider.getBlockNumber());
    expect(again.inserted).toBe(0);
    expect(await db!.transfer.count()).toBe(before);
  }, 120_000);

  it("links a real governance flow to our proposal and moves its status to HALTED", async () => {
    const version = await db!.proposalVersion.findFirstOrThrow({ where: { proposal: { slug: SLUG } } });

    // 1. commit v1 to the registry from the backend key (#0); skip if an earlier run already did
    const registry = at("ProposalRegistry", 0);
    const head = ((await registry.getFunction("latestVersionHash")(9951n)) as string).toLowerCase();
    if (head === ZeroHash) await (await registry.getFunction("commit")(9951n, version.versionHash, ZeroHash, version.evidenceRoot, "poi://MIP-9951/v1")).wait();

    // 2. propose MIP-21's actions from the MIP-21 proposer (#13), vote with delegates #2 and #3, queue
    const { targets, calldatas } = encodeActions(version.canonicalJson && (version.canonicalJson as { onchainActions: unknown }).onchainActions, deployments!, SLUG);
    const values = targets.map(() => 0n);
    const description = `# ${SLUG}: listener test ${Date.now()}`;
    const governor = at("MeridianGovernor", 13);
    await (await governor.getFunction("propose")(targets, values, calldatas, description)).wait();
    const proposalId = (await governor.getFunction("hashProposal")(targets, values, calldatas, keccak256(toUtf8Bytes(description)))) as bigint;
    await mine(2);
    for (const voter of [2, 3]) await (await at("MeridianGovernor", voter).getFunction("castVote")(proposalId, 1)).wait();
    await mine(21);
    const queueTx = await (await governor.getFunction("queue")(targets, values, calldatas, keccak256(toUtf8Bytes(description)))).wait();

    // 3. the watchdog (#1) flags the queued operation (id taken from CallScheduled, as the backend will)
    const timelock = new Contract(deployments!.contracts.GuardedTimelock!.address, deployments!.contracts.GuardedTimelock!.abi as never, provider);
    const scheduled = queueTx!.logs.map((l: { topics: readonly string[]; data: string }) => { try { return timelock.interface.parseLog(l); } catch { return null; } }).find((e: { name?: string } | null) => e?.name === "CallScheduled");
    const operationId = scheduled!.args.id as string;
    await (await at("GovernanceGuard", 1).getFunction("flag")(operationId, keccak256(toUtf8Bytes("findings")))).wait();

    await listener.tick();

    const p = await db!.proposal.findUniqueOrThrow({ where: { slug: SLUG }, include: { versions: true, chainEvents: true } });
    expect(p.governorProposalId).toBe(proposalId.toString());
    expect(p.operationId).toBe(operationId.toLowerCase());
    expect(p.status).toBe("HALTED");
    expect(p.versions[0]?.commitTxHash).toMatch(/^0x[0-9a-f]{64}$/); // linked from ProposalCommitted

    const names = p.chainEvents.filter((e) => e.blockNumber >= queueTx!.blockNumber - 40).map((e) => e.name);
    for (const n of ["ProposalCreated", "VoteCast", "ProposalQueued", "CallScheduled", "Flagged"]) expect(names).toContain(n);
    expect(names.filter((n) => n === "VoteCast").length).toBeGreaterThanOrEqual(2);
    expect(names.filter((n) => n === "CallScheduled").length).toBeGreaterThanOrEqual(2); // one per call in the batch

    // Live events were broadcast with the slug. Only the listener that inserts an event broadcasts it, so when a
    // backend dev server is running against the same database it may store (and broadcast) them first.
    const otherListener = await fetch(`http://localhost:${process.env.PORT ?? 4000}/health`).then((r) => r.ok, () => false);
    if (otherListener) return;
    const mine_ = live.filter((e) => e.proposalId === SLUG).map((e) => e.name);
    expect(mine_).toEqual(expect.arrayContaining(["ProposalCreated", "VoteCast", "ProposalQueued", "CallScheduled", "Flagged"]));
    const flagged = live.find((e) => e.name === "Flagged");
    expect(String(flagged?.args.operationId).toLowerCase()).toBe(operationId.toLowerCase());
  }, 180_000);
});
