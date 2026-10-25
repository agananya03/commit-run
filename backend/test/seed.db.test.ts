// Round trip against the real Postgres from docker compose. Skips when the database is unreachable.
import { afterAll, describe, expect, it } from "vitest";
import { createDb, dbReachable } from "../src/db.js";
import { loadRootEnv } from "../src/loadRootEnv.js";
import type { ScenarioPlan } from "../src/seed/scenarios.js";
import { seedScenarios } from "../src/seed/seed.js";

loadRootEnv();
const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null;
const online = db ? await dbReachable(db) : false;

const SLUG = "MIP-9901"; // throwaway, deleted in afterAll
const plan = (sha: string): ScenarioPlan => ({
  slug: SLUG,
  title: "seed round trip",
  proposer: "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec",
  files: [
    { type: "forum", uri: "data/scenarios/MIP-9901/forum_thread.json", sha256: sha, bytes: 10 },
    { type: "pdf", uri: "data/scenarios/MIP-9901/proposal.pdf", sha256: `0x${"b".repeat(64)}`, bytes: 20 },
  ],
});

describe.skipIf(!online)("seedScenarios (database)", () => {
  afterAll(async () => {
    await db?.proposal.deleteMany({ where: { slug: SLUG } });
    await db?.$disconnect();
  });

  it("creates the proposal and its staged evidence files", async () => {
    if (!db) return;
    const [outcome] = await seedScenarios(db, [plan(`0x${"a".repeat(64)}`)]);
    const proposal = await db.proposal.findUniqueOrThrow({ where: { slug: SLUG }, include: { evidenceFiles: true } });
    expect(outcome?.files).toBe(2);
    expect(proposal.status).toBe("DRAFT");
    expect(proposal.evidenceFiles.map((f) => f.type).sort()).toEqual(["forum", "pdf"]);
    expect(proposal.evidenceFiles.every((f) => f.proposalVersionId === null)).toBe(true);
  });

  it("is idempotent: re-seeding replaces staged files instead of duplicating them", async () => {
    if (!db) return;
    await seedScenarios(db, [plan(`0x${"c".repeat(64)}`)]);
    const files = await db.evidenceFile.findMany({ where: { proposal: { slug: SLUG } } });
    expect(files).toHaveLength(2);
    expect(files.find((f) => f.type === "forum")?.sha256).toBe(`0x${"c".repeat(64)}`);
  });

  it("never touches files already sealed into a version", async () => {
    if (!db) return;
    const proposal = await db.proposal.findUniqueOrThrow({ where: { slug: SLUG } });
    const version = await db.proposalVersion.create({
      data: { proposalId: proposal.id, version: 1, canonicalJson: {}, versionHash: `0x${"1".repeat(64)}`, prevHash: `0x${"0".repeat(64)}`, evidenceRoot: `0x${"2".repeat(64)}` },
    });
    await db.evidenceFile.updateMany({ where: { proposalId: proposal.id }, data: { proposalVersionId: version.id } });

    await seedScenarios(db, [plan(`0x${"d".repeat(64)}`)]);
    const sealed = await db.evidenceFile.findMany({ where: { proposalVersionId: version.id } });
    const staged = await db.evidenceFile.findMany({ where: { proposalId: proposal.id, proposalVersionId: null } });
    expect(sealed).toHaveLength(2);
    expect(sealed.find((f) => f.type === "forum")?.sha256).toBe(`0x${"c".repeat(64)}`);
    expect(staged).toHaveLength(2);
  });
});
