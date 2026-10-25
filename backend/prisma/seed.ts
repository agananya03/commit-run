// npm run db:seed (or npx prisma db seed): reads <DATA_DIR>/scenarios/MIP-*/ and creates
// Proposal + EvidenceFile rows with sha256 computed from the file bytes.
import { pino } from "pino";
import { createDb } from "../src/db.js";
import { loadEnv } from "../src/env.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";
import { loadScenarios } from "../src/seed/scenarios.js";
import { seedScenarios } from "../src/seed/seed.js";

loadRootEnv();
const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "seed" } });
const db = createDb(env.DATABASE_URL);

try {
  const { plans, errors } = loadScenarios(env.DATA_DIR, repoRoot);
  if (plans.length === 0 && errors.length === 0) {
    logger.warn({ dataDir: env.DATA_DIR }, "no scenarios found (expected <DATA_DIR>/scenarios/MIP-*/); nothing seeded");
  }
  for (const e of errors) logger.error(e, "scenario skipped");

  const outcomes = await seedScenarios(db, plans);
  for (const o of outcomes) logger.info(o, "seeded");
  process.exitCode = errors.length > 0 ? 1 : 0;
} finally {
  await db.$disconnect();
}
