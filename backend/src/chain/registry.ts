import { isError, type Contract, type NonceManager, type Provider } from "ethers";
import { HttpError } from "../errors.js";

export interface CommitArgs {
  proposalNumericId: bigint;
  versionHash: string;
  prevHash: string;
  evidenceRoot: string;
  uri: string;
}

export interface CommitReceipt {
  txHash: string;
  blockNumber: number;
  /** True when the version was already on-chain and the tx was recovered from the ProposalCommitted log. */
  recovered: boolean;
}

/** MIP-21 -> 21: the ProposalRegistry key. Deterministic and available before the Governor proposal exists. */
export function proposalNumericId(slug: string): bigint {
  const m = /^[A-Z]+-(\d+)$/.exec(slug);
  if (!m) throw new HttpError(400, "VALIDATION_FAILED", `Cannot derive a registry id from slug ${slug}`);
  return BigInt(m[1]!);
}

/** Thin, typed wrapper around ProposalRegistry for one committer key. */
export class RegistryClient {
  constructor(
    private readonly registry: Contract,
    private readonly signer: NonceManager,
    private readonly rpcUrl: string,
  ) {}

  get address(): string {
    return this.registry.target as string;
  }

  /** Fails with a clear message if nothing is deployed at the registry address (e.g. a fresh node). */
  async assertDeployed(): Promise<void> {
    const code = await this.call(() => (this.registry.runner as { provider: Provider }).provider.getCode(this.address));
    if (code === "0x") {
      throw new HttpError(502, "UPSTREAM_UNAVAILABLE", `No ProposalRegistry at ${this.address} on ${this.rpcUrl}; run \`npm run deploy:seed\` in /contracts`);
    }
  }

  latestVersionHash(id: bigint): Promise<string> {
    return this.call(() => this.registry.getFunction("latestVersionHash")(id) as Promise<string>);
  }

  /** Dry-runs first (decodes reverts without spending a nonce), then sends and waits for the receipt. */
  async commit(a: CommitArgs): Promise<CommitReceipt> {
    const fn = this.registry.getFunction("commit");
    const params = [a.proposalNumericId, a.versionHash, a.prevHash, a.evidenceRoot, a.uri] as const;
    await this.call(() => fn.staticCall(...params));
    try {
      const tx = await fn(...params);
      const receipt = await tx.wait();
      if (!receipt) throw new Error("no receipt");
      return { txHash: receipt.hash, blockNumber: receipt.blockNumber, recovered: false };
    } catch (err) {
      this.signer.reset(); // a failed send must not leave a gap in the NonceManager's local nonce
      throw this.toHttpError(err);
    }
  }

  /** Finds the ProposalCommitted log for an already-committed version (used to recover a lost tx hash). */
  async findCommit(id: bigint, versionHash: string): Promise<CommitReceipt | null> {
    const logs = await this.call(() => this.registry.queryFilter(this.registry.filters.ProposalCommitted!(id), 0, "latest"));
    for (const log of logs) {
      const args = (log as { args?: { versionHash?: string } }).args;
      if (args?.versionHash?.toLowerCase() === versionHash.toLowerCase()) {
        return { txHash: log.transactionHash, blockNumber: log.blockNumber, recovered: true };
      }
    }
    return null;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw this.toHttpError(err);
    }
  }

  private toHttpError(err: unknown): HttpError {
    if (err instanceof HttpError) return err;
    if (isError(err, "CALL_EXCEPTION") && err.revert) {
      const { name, args } = err.revert;
      if (name === "StalePrevHash") {
        return new HttpError(409, "CHAIN_REVERT", `ProposalRegistry rejected a stale prevHash: on-chain latest is ${args[0]}, this version expects ${args[1]}`, { expected: args[0], got: args[1] });
      }
      if (name === "NotCommitter") {
        return new HttpError(409, "CHAIN_REVERT", `This proposal's chain on ProposalRegistry belongs to ${args[0]}, not the backend's committer ${args[1]}`, { owner: args[0], committer: args[1] });
      }
      return new HttpError(409, "CHAIN_REVERT", `ProposalRegistry reverted with ${name}`, { args: args.map(String) });
    }
    if (isError(err, "CALL_EXCEPTION")) return new HttpError(409, "CHAIN_REVERT", `ProposalRegistry call reverted: ${err.shortMessage}`);
    return new HttpError(502, "UPSTREAM_UNAVAILABLE", `Chain RPC at ${this.rpcUrl} failed: ${(err as Error).message.split("\n")[0]}`);
  }
}
