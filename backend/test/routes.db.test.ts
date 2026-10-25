// HTTP routes against the real Postgres from docker compose. Skips when the database is unreachable.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDb, dbReachable } from "../src/db.js";
import { hashCanonical, ZERO_HASH } from "../src/integrity/hash.js";
import { verifyEvidenceProof } from "../src/integrity/merkle.js";
import { verifyChain } from "../src/integrity/versionChain.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { ProposalService } from "../src/proposals/service.js";

loadRootEnv();
const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
const online = db ? await dbReachable(db) : false;

const SCENARIO = "MIP-9921"; // test/fixtures-api/scenarios/MIP-9921
const UPLOADED = "MIP-9922"; // created by multipart upload
const uploadDir = mkdtempSync(join(tmpdir(), "poi-uploads-"));
const dataDir = fileURLToPath(new URL("./fixtures-api", import.meta.url));

const app = db
  ? createApp({
      logger: pino({ level: "silent" }),
      mocks: true,
      checks: {},
      proposals: new ProposalService({ db, dataDir, uploadDir, repoRoot }),
    })
  : null;

describe.skipIf(!online)("proposal routes (database)", () => {
  const api = () => request(app!);

  afterAll(async () => {
    await db?.proposal.deleteMany({ where: { slug: { in: [SCENARIO, UPLOADED] } } });
    await db?.$disconnect();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it("POST /proposals {slug} registers the scenario and seals version 1", async () => {
    const res = await api().post("/proposals").send({ slug: SCENARIO }).expect(201);
    const { proposal, versions } = res.body;
    expect(proposal).toMatchObject({ slug: SCENARIO, status: "DRAFT", proposer: "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec" });
    expect(versions).toHaveLength(1);
    const v1 = versions[0];
    expect(v1.prevHash).toBe(ZERO_HASH);
    expect(hashCanonical(v1.canonicalJson)).toBe(v1.versionHash);
    expect(v1.canonicalJson.onchainActions).toEqual({ actions: [{ contract: "Vault", function: "upgradeToAndCall" }] });
    expect(v1.files.map((f: { type: string }) => f.type).sort()).toEqual(["disclosure", "forum", "onchain", "pdf", "social"]);
    for (const f of v1.files) expect(verifyEvidenceProof(v1.evidenceRoot, f, f.proof)).toBe(true);
    expect(res.body).toMatchObject({ summary: null, intent: null, simulation: null, coi: null, findings: [], risk: null, chainEvents: [], flag: null });
  });

  it("POST /proposals again for the same slug is a 409", async () => {
    const res = await api().post("/proposals").send({ slug: SCENARIO }).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("GET /proposals lists it and GET /proposals/:id works by slug and by id", async () => {
    const list = await api().get("/proposals").expect(200);
    const row = list.body.find((p: { slug: string }) => p.slug === SCENARIO);
    expect(row).toBeDefined();
    const bySlug = await api().get(`/proposals/${SCENARIO}`).expect(200);
    const byId = await api().get(`/proposals/${row.id}`).expect(200);
    expect(byId.body.versions[0].versionHash).toBe(bySlug.body.versions[0].versionHash);
  });

  it("POST /proposals/:id/versions with a new PDF seals version 2 linked to version 1", async () => {
    const before = await api().get(`/proposals/${SCENARIO}`).expect(200);
    const v1 = before.body.versions[0];
    const res = await api()
      .post(`/proposals/${SCENARIO}/versions`)
      .attach("pdf", Buffer.from("%PDF-1.4\n% edited after the vote\n%%EOF\n"), "proposal.pdf")
      .expect(201);
    const v2 = res.body;
    expect(v2.version).toBe(2);
    expect(v2.prevHash).toBe(v1.versionHash);
    expect(v2.evidenceRoot).not.toBe(v1.evidenceRoot);
    const pdf = (v: { files: { type: string; sha256: string; uri: string }[] }) => v.files.find((f) => f.type === "pdf")!;
    expect(pdf(v2).sha256).not.toBe(pdf(v1).sha256);
    expect(pdf(v2).uri).toMatch(/proposal\.pdf$/);
    // unchanged files carry over
    expect(v2.files.find((f: { type: string }) => f.type === "forum").sha256).toBe(v1.files.find((f: { type: string }) => f.type === "forum").sha256);

    const after = await api().get(`/proposals/${SCENARIO}`).expect(200);
    expect(verifyChain(after.body.versions)).toEqual({ ok: true });
  });

  it("re-uploading identical content is a 409 (no empty versions)", async () => {
    const res = await api()
      .post(`/proposals/${SCENARIO}/versions`)
      .attach("pdf", Buffer.from("%PDF-1.4\n% edited after the vote\n%%EOF\n"), "proposal.pdf")
      .expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("POST /proposals/:id/versions with no body re-reads the scenario folder", async () => {
    const res = await api().post(`/proposals/${SCENARIO}/versions`).expect(201);
    expect(res.body.version).toBe(3); // the folder still has the original PDF, so content differs from v2
  });

  it("POST /proposals as multipart registers an uploaded proposal", async () => {
    const res = await api()
      .post("/proposals")
      .field("slug", UPLOADED)
      .field("title", "Uploaded grant")
      .field("proposer", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
      .attach("forum", Buffer.from(JSON.stringify({ title: "Uploaded grant" })), "forum_thread.json")
      .attach("onchain", Buffer.from(JSON.stringify({ actions: [{ contract: "Treasury", function: "transfer" }] })), "onchain_actions.json")
      .expect(201);
    expect(res.body.proposal).toMatchObject({ slug: UPLOADED, title: "Uploaded grant", proposer: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" });
    expect(res.body.versions[0].files).toHaveLength(2);
    expect(res.body.versions[0].canonicalJson.onchainActions).toEqual({ actions: [{ contract: "Treasury", function: "transfer" }] });
  });

  it.each([
    ["an unknown proposal", () => api().get("/proposals/MIP-0000"), 404, "NOT_FOUND"],
    ["a missing slug", () => api().post("/proposals").send({}), 400, "VALIDATION_FAILED"],
    ["an extra JSON field", () => api().post("/proposals").send({ slug: SCENARIO, x: 1 }), 400, "VALIDATION_FAILED"],
    ["a scenario folder that does not exist", () => api().post("/proposals").send({ slug: "MIP-0001" }), 404, "NOT_FOUND"],
    ["a bad proposer on upload", () => api().post("/proposals").field("slug", "MIP-9923").field("title", "t").field("proposer", "nope").attach("forum", Buffer.from("{}"), "f.json"), 400, "VALIDATION_FAILED"],
    ["an unknown upload field", () => api().post(`/proposals/${SCENARIO}/versions`).attach("votes", Buffer.from("{}"), "votes.json"), 400, "VALIDATION_FAILED"],
    ["malformed JSON", () => api().post("/proposals").set("content-type", "application/json").send("{bad"), 400, "VALIDATION_FAILED"],
    ["an unknown route", () => api().get("/nope"), 404, "NOT_FOUND"],
  ])("returns an ApiError for %s", async (_label, call, status, code) => {
    const res = await call().expect(status);
    expect(res.body).toMatchObject({ error: { code } });
  });
});
