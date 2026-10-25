// Pipeline against the real Redis and Postgres from docker compose, with rag/sim served from mocks and a
// stub committer (the on-chain commit itself is covered by commit.chain.test.ts). Each run uses its own
// Redis key prefix so it never touches the real queue. Skips when Redis or Postgres is unreachable.
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PipelineProgress } from "../../shared/schemas/types.js";
import { loadDeployments } from "../src/chain/contracts.js";
import { RagClient } from "../src/clients/ragClient.js";
import { SimClient } from "../src/clients/simClient.js";
import { createDb, dbReachable } from "../src/db.js";
import type { EventBus } from "../src/events.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { jobId, Pipeline } from "../src/pipeline/pipeline.js";
import { ProposalService } from "../src/proposals/service.js";

loadRootEnv();
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;
const redisUp = await new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null })
  .ping()
  .then(() => true, () => false);
const online = redisUp && (db ? await dbReachable(db) : false);

const SLUG = "MIP-9941";
const BROKEN = "MIP-9942"; // no ingest mock and rag down: ingest must fail after its retries
const sharedMocks = fileURLToPath(new URL("../../shared/mocks", import.meta.url));
const mocksDir = mkdtempSync(join(tmpdir(), "poi-mocks-"));
const uploadDir = mkdtempSync(join(tmpdir(), "poi-uploads-"));
const dataDir = fileURLToPath(new URL("./fixtures-api", import.meta.url));
const logger = pino({ level: "silent" });
const events: PipelineProgress[] = [];
const bus: EventBus = { emit: (_e, p) => void events.push(p as PipelineProgress) };

let pipeline: Pipeline;
let proposals: ProposalService;
const commits: string[] = [];

describe.skipIf(!online)("BullMQ pipeline (redis + postgres)", () => {
  beforeAll(async () => {
    // The MIP-21 mocks stand in for this fixture proposal.
    for (const f of readdirSync(sharedMocks).filter((x) => x.includes("MIP-21") && !x.startsWith("ingest"))) {
      copyFileSync(join(sharedMocks, f), join(mocksDir, f.replace("MIP-21", SLUG)));
    }
    copyFileSync(join(sharedMocks, "ingest.MIP-21.json"), join(mocksDir, `ingest.${SLUG}.json`));
    copyFileSync(join(sharedMocks, "deployments.json"), join(mocksDir, "deployments.json"));

    const realProposals = new ProposalService({ db: db!, dataDir, uploadDir, repoRoot });
    // Stub committer: records a fake tx hash the way ProposalService.commit would.
    proposals = Object.assign(Object.create(realProposals) as ProposalService, {
      async commit(id: string) {
        const v = await db!.proposalVersion.findFirstOrThrow({ where: { proposalId: id, commitTxHash: null }, orderBy: { version: "asc" } });
        const txHash = `0x${commits.length.toString(16).padStart(64, "0")}`;
        commits.push(txHash);
        await db!.proposalVersion.update({ where: { id: v.id }, data: { commitTxHash: txHash } });
        return { proposalId: id, version: v.version, versionHash: v.versionHash, txHash, blockNumber: 1 };
      },
    });

    const up = { baseURL: "http://127.0.0.1:1", timeoutMs: 500, useMocks: false, mocksDir, logger }; // services "down" -> mocks
    const { deployments } = loadDeployments(join(mocksDir, "deployments.json"), join(mocksDir, "deployments.json"), logger);
    pipeline = new Pipeline({
      redisUrl: REDIS_URL,
      prefix: `test-${process.pid}-${Date.now()}`,
      db: db!,
      deps: { db: db!, rag: new RagClient(up), sim: new SimClient(up), proposals, deployments, repoRoot },
      bus,
      logger,
      concurrency: 4,
    });

    await db!.proposal.deleteMany({ where: { slug: { in: [SLUG, BROKEN] } } });
    await realProposals.createFromScenario(SLUG);
    await realProposals.createFromScenario(BROKEN);
  });

  afterAll(async () => {
    await pipeline?.queue.obliterate({ force: true });
    await pipeline?.close();
    await db?.proposal.deleteMany({ where: { slug: { in: [SLUG, BROKEN] } } });
    await db?.$disconnect();
    for (const d of [mocksDir, uploadDir]) rmSync(d, { recursive: true, force: true });
  });

  const failures = (slug: string) => JSON.stringify(events.filter((e) => e.proposalId === slug && e.status === "failed"));
  const versionId = async (slug: string) => (await db!.proposalVersion.findFirstOrThrow({ where: { proposal: { slug } }, orderBy: { version: "desc" } })).id;

  it("runs every step in order and stores each output", async () => {
    const run = await pipeline.run(SLUG);
    const vid = await versionId(SLUG);
    expect(run.flowId).toBe(`pipeline:${vid}`);
    expect(await pipeline.waitForRun(vid), failures(SLUG)).toBe("completed");

    const v = await db!.proposalVersion.findUniqueOrThrow({ where: { id: vid }, include: { summary: true, intentSpec: true, simulationRuns: true, proposal: true } });
    expect(v.summary?.tldr).toMatch(/VaultV2/);
    expect(v.intentSpec?.actionCount).toBe(1);
    expect(v.commitTxHash).toBe(commits[0]);
    expect(v.simulationRuns).toHaveLength(1);
    expect(v.simulationRuns[0]).toMatchObject({ source: "PROPOSED", success: true });
    expect(v.proposal.status).toBe("INGESTED"); // the stub committer does not touch status

    // simulate got calldata encoded from the fixture's on-chain actions
    const simJob = await pipeline.queue.getJob(jobId(vid, "simulate"));
    expect(simJob?.returnvalue).toMatchObject({ success: true, calls: 2 }); // upgradeToAndCall + treasury.approve
    const coiJob = await pipeline.queue.getJob(jobId(vid, "coi"));
    expect(coiJob?.returnvalue).toMatchObject({ signatureValid: false });
    expect(await db!.coiReportRecord.findUnique({ where: { proposalVersionId: vid } })).not.toBeNull();
    const verdictJob = await pipeline.queue.getJob(jobId(vid, "verdict"));
    expect(verdictJob?.returnvalue).toMatchObject({ explanation: "template" }); // rag is "down" and has no explain mock
    const simRun = await db!.simulationRun.findFirstOrThrow({ where: { proposalVersionId: vid } });
    expect(simRun.explanation).toMatchObject({ headline: expect.any(String) });
    expect(await db!.finding.count({ where: { simulationRunId: simRun.id } })).toBe(verdictJob?.returnvalue.findings);
  });

  it("emits started and completed for every step, in dependency order", () => {
    const mine = events.filter((e) => e.proposalId === SLUG);
    const completed = mine.filter((e) => e.status === "completed").map((e) => e.step);
    expect(new Set(completed)).toEqual(new Set(["ingest", "summarize", "extractIntent", "commit", "coi", "simulate", "verdict", "risk"]));
    const at = (s: string) => completed.indexOf(s as never);
    expect(at("ingest")).toBeLessThan(at("summarize"));
    expect(at("ingest")).toBeLessThan(at("extractIntent"));
    expect(Math.max(at("summarize"), at("extractIntent"))).toBeLessThan(at("commit"));
    for (const [a, b] of [["commit", "simulate"], ["simulate", "coi"], ["coi", "verdict"], ["verdict", "risk"]] as const) expect(at(a)).toBeLessThan(at(b));
    for (const e of mine.filter((x) => x.status === "completed")) expect(e.ms).toBeGreaterThanOrEqual(0);
    expect(mine.filter((e) => e.status === "started")).toHaveLength(8);
  });

  it("refuses a second run of the same version, and re-runs idempotently with force", async () => {
    await expect(pipeline.run(SLUG)).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    const vid = await versionId(SLUG);
    await pipeline.run(SLUG, { force: true });
    expect(await pipeline.waitForRun(vid), failures(SLUG)).toBe("completed");
    expect(await db!.summary.count({ where: { proposalVersionId: vid } })).toBe(1);
    expect(await db!.simulationRun.count({ where: { proposalVersionId: vid } })).toBe(1);
    expect(commits).toHaveLength(1); // the commit step saw the stored tx hash and skipped
    const summarize = await pipeline.queue.getJob(jobId(vid, "summarize"));
    expect(summarize?.returnvalue).toMatchObject({ cached: true });
  });

  it("retries a failing step twice, reports it, and stops the pipeline", async () => {
    await pipeline.run(BROKEN);
    const vid = await versionId(BROKEN);
    expect(await pipeline.waitForRun(vid, 20_000)).toBe("failed");
    const ingest = await pipeline.queue.getJob(jobId(vid, "ingest"));
    expect(ingest?.attemptsMade).toBe(3);
    expect(await pipeline.queue.getJob(jobId(vid, "summarize"))).toBeUndefined(); // the rest was never enqueued
    const failures = events.filter((e) => e.proposalId === BROKEN && e.status === "failed");
    expect(failures.length).toBe(3);
    expect(failures[0]?.error).toMatch(/no mock|unavailable/i);
  }, 25_000);
});
