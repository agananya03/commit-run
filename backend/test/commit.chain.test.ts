// POST /proposals/:id/commit against a RUNNING Hardhat node (npx hardhat node in /contracts) and the
// docker Postgres. Deploys its own fresh ProposalRegistry from the compiled artifact, so it never depends
// on (or disturbs) deploy:seed state. Skips when either the node or the database is unreachable.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, Network, NonceManager, Wallet, type Contract } from "ethers";
import { pino } from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { rpcReachable } from "../src/chain/provider.js";
import { RegistryClient } from "../src/chain/registry.js";
import { createDb, dbReachable } from "../src/db.js";
import { verifyChain } from "../src/integrity/versionChain.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { ProposalService } from "../src/proposals/service.js";

loadRootEnv();
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const artifactPath = join(repoRoot, "contracts", "artifacts", "contracts", "ProposalRegistry.sol", "ProposalRegistry.json");
const provider = new JsonRpcProvider(RPC, Network.from(31337), { staticNetwork: true });
provider.pollingInterval = 100;
const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
const online = existsSync(artifactPath) && (await rpcReachable(provider, 5000)) && (db ? await dbReachable(db) : false);

const SLUG = "MIP-9931"; // own fixture: routes.db.test.ts uses MIP-9921 and test files run in parallel
const dataDir = fileURLToPath(new URL("./fixtures-api", import.meta.url));
const uploadDir = mkdtempSync(join(tmpdir(), "poi-commit-"));

let registryContract: Contract;
let other: NonceManager;
let app: ReturnType<typeof createApp>;

describe.skipIf(!online)("POST /proposals/:id/commit (hardhat node)", () => {
  beforeAll(async () => {
    // Hardhat accounts #70 (backend committer here) and #71 (another address); deploy:seed never sends from them.
    const mnemonic = "test test test test test test test test test test test junk";
    const at = (i: number) => HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${i}`).privateKey;
    const committer = new NonceManager(new Wallet(at(70), provider));
    other = new NonceManager(new Wallet(at(71), provider));

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: never; bytecode: string };
    const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, committer).deploy();
    await deployed.waitForDeployment();
    registryContract = deployed as unknown as Contract;

    await db!.proposal.deleteMany({ where: { slug: SLUG } });
    app = createApp({
      logger: pino({ level: "silent" }),
      mocks: true,
      checks: {},
      proposals: new ProposalService({ db: db!, dataDir, uploadDir, repoRoot, registry: new RegistryClient(registryContract, committer, RPC) }),
    });
  });

  afterAll(async () => {
    await db?.proposal.deleteMany({ where: { slug: SLUG } });
    await db?.$disconnect();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const api = () => request(app);
  const latest = () => registryContract.getFunction("latestVersionHash")(9931n) as Promise<string>;

  it("commits version 1 and stores the tx hash", async () => {
    await api().post("/proposals").send({ slug: SLUG }).expect(201);
    const res = await api().post(`/proposals/${SLUG}/commit`).expect(200);
    expect(res.body).toMatchObject({ version: 1 });
    expect(res.body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const bundle = await api().get(`/proposals/${SLUG}`).expect(200);
    expect(bundle.body.versions[0].commitTxHash).toBe(res.body.txHash);
    expect(bundle.body.proposal.status).toBe("COMMITTED");
    expect((await latest()).toLowerCase()).toBe(bundle.body.versions[0].versionHash);
    const receipt = await provider.getTransactionReceipt(res.body.txHash);
    expect(receipt?.status).toBe(1);
  });

  it("is a 409 CONFLICT when nothing is pending", async () => {
    const res = await api().post(`/proposals/${SLUG}/commit`).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("commits versions 2 and 3 in order in one call; the on-chain history mirrors the DB chain", async () => {
    await api().post(`/proposals/${SLUG}/versions`).attach("pdf", Buffer.from("%PDF-1.4\n% v2\n%%EOF\n"), "proposal.pdf").expect(201);
    await api().post(`/proposals/${SLUG}/versions`).attach("pdf", Buffer.from("%PDF-1.4\n% v3\n%%EOF\n"), "proposal.pdf").expect(201);
    const res = await api().post(`/proposals/${SLUG}/commit`).expect(200);
    expect(res.body.version).toBe(3);

    const bundle = await api().get(`/proposals/${SLUG}`).expect(200);
    const versions = bundle.body.versions as { versionHash: string; commitTxHash: string }[];
    expect(versions.every((v) => v.commitTxHash)).toBe(true);
    expect(verifyChain(bundle.body.versions)).toEqual({ ok: true });
    const history = ((await registryContract.getFunction("getHistory")(9931n)) as string[]).map((h) => h.toLowerCase());
    expect(history).toEqual(versions.map((v) => v.versionHash));
  });

  it("recovers a version committed on-chain that the DB did not record", async () => {
    await api().post(`/proposals/${SLUG}/versions`).attach("pdf", Buffer.from("%PDF-1.4\n% v4\n%%EOF\n"), "proposal.pdf").expect(201);
    const bundle = await api().get(`/proposals/${SLUG}`).expect(200);
    const v4 = bundle.body.versions[3];
    // Commit v4 directly with the same committer key, bypassing the backend.
    const asCommitter = registryContract;
    const tx = await asCommitter.getFunction("commit")(9931n, v4.versionHash, v4.prevHash, v4.evidenceRoot, "poi://manual");
    const mined = await tx.wait();
    const res = await api().post(`/proposals/${SLUG}/commit`).expect(200);
    expect(res.body).toMatchObject({ version: 4, txHash: mined.hash });
  });

  it("rejects a stale chain with a clear 409 CHAIN_REVERT", async () => {
    // Someone appends an unrelated version on-chain (same committer key), so our v5's prevHash is stale.
    const forged = `0x${"ab".repeat(32)}`;
    const head = await latest();
    await (await registryContract.getFunction("commit")(9931n, forged, head, forged, "poi://forged")).wait();
    await api().post(`/proposals/${SLUG}/versions`).attach("pdf", Buffer.from("%PDF-1.4\n% v5\n%%EOF\n"), "proposal.pdf").expect(201);

    const res = await api().post(`/proposals/${SLUG}/commit`).expect(409);
    expect(res.body.error.code).toBe("CHAIN_REVERT");
    expect(res.body.error.message).toMatch(/Stale prevHash/);
    expect(res.body.error.details.onchainLatest).toBe(forged);
  });

  it("explains when another address owns the proposal's registry chain", async () => {
    // A different account claims registry id 9922 first; the backend's committer cannot extend it.
    await (await registryContract.connect(other).getFunction("commit")(9932n, `0x${"cd".repeat(32)}`, `0x${"00".repeat(32)}`, `0x${"cd".repeat(32)}`, "poi://squatter")).wait();
    const ours = new RegistryClient(registryContract, (registryContract.runner as NonceManager), RPC);
    const err = await ours
      .commit({ proposalNumericId: 9932n, versionHash: `0x${"ef".repeat(32)}`, prevHash: `0x${"cd".repeat(32)}`, evidenceRoot: `0x${"ef".repeat(32)}`, uri: "x" })
      .then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: "CHAIN_REVERT" });
    expect((err as Error).message).toMatch(/belongs to/);
  });
});
