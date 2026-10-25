import { join } from "node:path";
import { z } from "zod";
import { repoRoot } from "./loadRootEnv.js";

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
});

export type Env = z.infer<typeof Env>;

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return Env.parse(env);
}
