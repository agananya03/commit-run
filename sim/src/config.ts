import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(4002),
  /** Anvil fork the simulations run on (npm run fork in /contracts). */
  ANVIL_URL: z.url().default("http://127.0.0.1:8546"),
  /** Hardhat node the fork is taken from. */
  RPC_URL: z.url().default("http://127.0.0.1:8545"),
  USE_MOCKS: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return Env.parse(env);
}
