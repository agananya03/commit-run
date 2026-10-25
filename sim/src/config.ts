import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4002),
  /** Anvil fork the simulations run on (npm run fork in /contracts). */
  ANVIL_URL: z.url().default("http://127.0.0.1:8546"),
  /** Hardhat node the fork is taken from; each simulation re-forks it at its latest block (or forkBlock). */
  RPC_URL: z.url().default("http://127.0.0.1:8545"),
  /** Written by `npm run deploy:seed` in /contracts. */
  DEPLOYMENTS_FILE: z.string().default(`${repoRoot}contracts/deployments/localhost.json`),
  /** Used when DEPLOYMENTS_FILE does not exist yet (same deterministic addresses). */
  FALLBACK_DEPLOYMENTS_FILE: z.string().default(`${repoRoot}shared/mocks/deployments.json`),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
