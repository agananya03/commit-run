import { join } from "node:path";
import { z } from "zod";
import { repoRoot } from "./loadRootEnv.js";

const PrivateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "expected a 0x-prefixed 32-byte hex private key");

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().startsWith("postgresql://"),
  USE_MOCKS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Where synthetic scenarios live (D's /data); overridable for tests. */
  DATA_DIR: z.string().default(join(repoRoot, "data")),
  RAG_URL: z.url().default("http://localhost:8000"),
  SIM_URL: z.url().default("http://localhost:4002"),
  /** Timeout for rag/sim calls; rag /summarize targets < 20 s. */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  /** Canned rag/sim responses used when USE_MOCKS=true or a service is down. */
  MOCKS_DIR: z.string().default(join(repoRoot, "shared", "mocks")),
  /** Uploaded evidence files, stored content-addressed. */
  UPLOAD_DIR: z.string().default(join(repoRoot, "backend", ".uploads")),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  REDIS_URL: z.string().startsWith("redis://").default("redis://localhost:6379"),
  RPC_URL: z.url().default("http://127.0.0.1:8545"),
  /** Commits versions to ProposalRegistry. Default: Hardhat account #0 (public test key, local chain only). */
  PROPOSER_PRIVATE_KEY: PrivateKey.default("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"),
  /** Calls GovernanceGuard.flag(). Default: Hardhat account #1 (public test key, local chain only). */
  WATCHDOG_PRIVATE_KEY: PrivateKey.default("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"),
  /** Written by `npm run deploy:seed` in /contracts; MOCKS_DIR/deployments.json is the fallback. */
  DEPLOYMENTS_FILE: z.string().default(join(repoRoot, "contracts", "deployments", "localhost.json")),
});

export type Env = z.infer<typeof Env>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return Env.parse(env);
}
