// POST /proposals/:id/disclosure against the real Postgres. Skips when the database is unreachable.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HDNodeWallet } from "ethers";
import { pino } from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadDeployments } from "../src/chain/contracts.js";
import { disclosureMessage } from "../src/coi/disclosure.js";
import { coiReportFor } from "../src/coi/service.js";
import { createDb, dbReachable } from "../src/db.js";
import { verifyChain } from "../src/integrity/versionChain.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { ProposalService } from "../src/proposals/service.js";
import { hardhatAddress } from "../src/seed/scenarios.js";

loadRootEnv();
const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
const online = db ? await dbReachable(db) : false;

const SLUG = "MIP-9961"; // test/fixtures-api/scenarios/MIP-9961, proposer = Hardhat #13
const MNEMONIC = "test test test test test test test test test test test junk";
const key = (i: number) => HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
const uploadDir = mkdtempSync(join(tmpdir(), "poi-uploads-"));
const dataDir = fileURLToPath(new URL("./fixtures-api", import.meta.url));
const mocks = join(repoRoot, "shared", "mocks", "deployments.json");
const logger = pino({ level: "silent" });

const app = db
  ? createApp({
      logger,
      mocks: true,
      checks: {},
      proposals: new ProposalService({
        db,
        dataDir,
        uploadDir,
        repoRoot,
        coi: (versionId) => coiReportFor({ db, deployments: loadDeployments(mocks, mocks, logger).deployments, repoRoot }, versionId),
      }),
    })
  : null;

describe.skipIf(!online)("POST /proposals/:id/disclosure (database)", () => {
  const api = () => request(app!);
  const proposer = key(13);
  const wallets = [hardhatAddress(17), hardhatAddress(13)];
  const statement = "Wallets 13 and 17 are mine.";
  const sign = (signer: HDNodeWallet, slug = SLUG, ws = wallets, st = statement) => signer.signMessage(disclosureMessage(slug, ws, st));

  beforeAll(async () => {
    await db!.proposal.deleteMany({ where: { slug: SLUG } });
    await api().post("/proposals").send({ slug: SLUG }).expect(201);
  });

  afterAll(async () => {
    await db?.proposal.deleteMany({ where: { slug: SLUG } });
    await db?.$disconnect();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("rejects a signature by anyone but the proposer", async () => {
    const res = await api().post(`/proposals/${SLUG}/disclosure`).send({ proposer: proposer.address, wallets, statement, signature: await sign(key(14)) }).expect(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: { recovered: key(14).address.toLowerCase() } });
  });

  it("rejects a signature over a different slug or statement", async () => {
    await api().post(`/proposals/${SLUG}/disclosure`).send({ proposer: proposer.address, wallets, statement, signature: await sign(proposer, "MIP-21") }).expect(400);
    await api().post(`/proposals/${SLUG}/disclosure`).send({ proposer: proposer.address, wallets, statement: "edited", signature: await sign(proposer) }).expect(400);
  });

  it("rejects a body whose proposer is not the proposal's", async () => {
    await api().post(`/proposals/${SLUG}/disclosure`).send({ proposer: key(14).address, wallets, statement, signature: await sign(key(14)) }).expect(400);
  });

  it("accepts the proposer's signature, seals a new version with the disclosure as evidence, and returns the COI report", async () => {
    const res = await api().post(`/proposals/${SLUG}/disclosure`).send({ proposer: proposer.address, wallets, statement, signature: await sign(proposer) }).expect(201);
    expect(res.body).toMatchObject({ proposalId: SLUG, proposer: proposer.address.toLowerCase(), signatureValid: true, disclosed: wallets.map((w) => w.toLowerCase()).sort() });

    const bundle = (await api().get(`/proposals/${SLUG}`).expect(200)).body;
    expect(bundle.versions).toHaveLength(2);
    const [v1, v2] = bundle.versions;
    expect(v2.prevHash).toBe(v1.versionHash);
    expect(v2.evidenceRoot).not.toBe(v1.evidenceRoot);
    expect(v2.files.find((f: { type: string }) => f.type === "disclosure").uri).toMatch(/disclosure\.signed\.json$/);
    expect(verifyChain(bundle.versions).ok).toBe(true);
    expect(bundle.coi).toMatchObject({ signatureValid: true });
  });

  it("is a 409 when the same disclosure is submitted again", async () => {
    await api().post(`/proposals/${SLUG}/disclosure`).send({ proposer: proposer.address, wallets, statement, signature: await sign(proposer) }).expect(409);
  });
});
