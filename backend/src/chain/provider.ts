import { JsonRpcProvider, Network, NonceManager, Wallet } from "ethers";

export interface ChainSigners {
  /** Commits proposal versions to ProposalRegistry. */
  proposer: NonceManager;
  /** Calls GovernanceGuard.flag(). */
  watchdog: NonceManager;
}

/**
 * JSON-RPC provider for the local chain. The network is static (taken from the deployments file), so a
 * node that is down fails fast instead of ethers retrying network detection forever.
 */
export function createProvider(rpcUrl: string, chainId: number): JsonRpcProvider {
  const provider = new JsonRpcProvider(rpcUrl, Network.from(chainId), { staticNetwork: true });
  provider.pollingInterval = 250; // Hardhat mines instantly; don't wait the default 4 s for receipts
  return provider;
}

/** Each key gets its own NonceManager so concurrent commits/flags never reuse a nonce. */
export function createSigners(provider: JsonRpcProvider, keys: { proposer: string; watchdog: string }): ChainSigners {
  return {
    proposer: new NonceManager(new Wallet(keys.proposer, provider)),
    watchdog: new NonceManager(new Wallet(keys.watchdog, provider)),
  };
}

export async function rpcReachable(provider: JsonRpcProvider, timeoutMs = 1500): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      provider.getBlockNumber(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
