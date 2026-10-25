import { existsSync, readFileSync } from "node:fs";
import { Contract, type ContractRunner } from "ethers";
import type { Logger } from "pino";
import type { z } from "zod";
import { Deployments } from "../contracts/schemas.js";

export type DeploymentsT = z.infer<typeof Deployments>;

/**
 * Addresses and ABIs written by `npm run deploy:seed` in /contracts (deployments/localhost.json).
 * Until that exists, the shared mock (same shape, same deterministic addresses) is used with a warning.
 */
export function loadDeployments(primary: string, fallback: string, logger: Pick<Logger, "warn">): { deployments: DeploymentsT; source: string } {
  const source = existsSync(primary) ? primary : fallback;
  if (source === fallback) logger.warn({ primary, fallback }, "contracts deployments file not found; using the shared mock");
  const parsed = Deployments.safeParse(JSON.parse(readFileSync(source, "utf8")));
  if (!parsed.success) throw new Error(`Invalid deployments file ${source}: ${parsed.error.message}`);
  return { deployments: parsed.data, source };
}

export function contractAt(deployments: DeploymentsT, name: string, runner: ContractRunner): Contract {
  const entry = deployments.contracts[name];
  if (!entry) throw new Error(`${name} missing from deployments (have: ${Object.keys(deployments.contracts).join(", ")})`);
  return new Contract(entry.address, entry.abi as never, runner);
}
