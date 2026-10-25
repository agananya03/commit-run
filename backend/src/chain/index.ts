import { join } from "node:path";
import type { Logger } from "pino";
import type { Env } from "../env.js";
import { contractAt, loadDeployments, type DeploymentsT } from "./contracts.js";
import { createProvider, createSigners, rpcReachable, type ChainSigners } from "./provider.js";
import { RegistryClient } from "./registry.js";

export interface Chain {
  provider: ReturnType<typeof createProvider>;
  signers: ChainSigners;
  deployments: DeploymentsT;
  deploymentsSource: string;
  registry: RegistryClient;
  reachable: () => Promise<boolean>;
}

/** Provider, signers, deployments and contract clients for the local chain. Nothing touches the network here. */
export function createChain(env: Pick<Env, "RPC_URL" | "PROPOSER_PRIVATE_KEY" | "WATCHDOG_PRIVATE_KEY" | "DEPLOYMENTS_FILE" | "MOCKS_DIR">, logger: Pick<Logger, "warn">): Chain {
  const { deployments, source } = loadDeployments(env.DEPLOYMENTS_FILE, join(env.MOCKS_DIR, "deployments.json"), logger);
  const provider = createProvider(env.RPC_URL, deployments.chainId);
  const signers = createSigners(provider, { proposer: env.PROPOSER_PRIVATE_KEY, watchdog: env.WATCHDOG_PRIVATE_KEY });
  return {
    provider,
    signers,
    deployments,
    deploymentsSource: source,
    registry: new RegistryClient(contractAt(deployments, "ProposalRegistry", signers.proposer), signers.proposer, env.RPC_URL),
    reachable: () => rpcReachable(provider),
  };
}
