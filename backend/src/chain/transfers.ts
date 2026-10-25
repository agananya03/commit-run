import { id as eventTopic, getAddress, type JsonRpcProvider } from "ethers";
import type { Db } from "../db.js";
import type { DeploymentsT } from "./contracts.js";

const TRANSFER = eventTopic("Transfer(address,address,uint256)");
const BLOCK_BATCH = 100;
const PARALLEL = 8;

export interface ImportResult {
  fromBlock: number;
  toBlock: number;
  erc20: number;
  eth: number;
  inserted: number;
}

const topicAddress = (topic: string): string => getAddress(`0x${topic.slice(26)}`).toLowerCase();

/**
 * Imports value movements in [fromBlock, toBlock] into Transfer (the COI graph's input):
 * - ERC-20 Transfer logs of MeridianToken (MRD) and MockUSDC (mints show up as from 0x0)
 * - native ETH transfers: top-level transactions with value > 0 that succeeded (logIndex = -1)
 * Re-importing a range is safe: rows are unique on (txHash, logIndex).
 * Not covered: ETH moved by contracts internally (would need traces); the synthetic data has none.
 */
export async function importTransfers(db: Db, provider: JsonRpcProvider, deployments: DeploymentsT, fromBlock: number, toBlock: number): Promise<ImportResult> {
  if (toBlock < fromBlock) return { fromBlock, toBlock, erc20: 0, eth: 0, inserted: 0 };
  const tokens = ["MeridianToken", "MockUSDC"].map((n) => deployments.contracts[n]?.address).filter((a): a is string => Boolean(a));
  const timestamps = new Map<number, Date>();

  const rows: { txHash: string; logIndex: number; token: string | null; from: string; to: string; amount: string; blockNumber: number; timestamp: Date }[] = [];

  const importChunk = async (start: number): Promise<void> => {
    const end = Math.min(start + BLOCK_BATCH - 1, toBlock);
    const numbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const blocks = await Promise.all(numbers.map((n) => provider.getBlock(n, true)));
    const valueTxs = [];
    for (const block of blocks) {
      if (!block) continue;
      timestamps.set(block.number, new Date(block.timestamp * 1000));
      for (const tx of block.prefetchedTransactions) {
        if (tx.value > 0n && tx.to) valueTxs.push(tx);
      }
    }
    const receipts = await Promise.all(valueTxs.map((tx) => provider.getTransactionReceipt(tx.hash)));
    valueTxs.forEach((tx, i) => {
      if (receipts[i]?.status !== 1) return;
      rows.push({ txHash: tx.hash, logIndex: -1, token: null, from: tx.from.toLowerCase(), to: tx.to!.toLowerCase(), amount: tx.value.toString(), blockNumber: tx.blockNumber!, timestamp: timestamps.get(tx.blockNumber!)! });
    });

    if (tokens.length > 0) {
      const logs = await provider.getLogs({ address: tokens, topics: [TRANSFER], fromBlock: start, toBlock: end });
      for (const log of logs) {
        if (log.topics.length !== 3) continue; // not an ERC-20 Transfer shape
        rows.push({
          txHash: log.transactionHash,
          logIndex: log.index,
          token: log.address.toLowerCase(),
          from: topicAddress(log.topics[1]!),
          to: topicAddress(log.topics[2]!),
          amount: BigInt(log.data).toString(),
          blockNumber: log.blockNumber,
          timestamp: timestamps.get(log.blockNumber)!,
        });
      }
    }
  };

  // Up to PARALLEL chunks in flight; ethers batches each chunk into a few JSON-RPC batch requests.
  const starts: number[] = [];
  for (let s = fromBlock; s <= toBlock; s += BLOCK_BATCH) starts.push(s);
  for (let i = 0; i < starts.length; i += PARALLEL) await Promise.all(starts.slice(i, i + PARALLEL).map(importChunk));

  const { count } = rows.length > 0 ? await db.transfer.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
  return { fromBlock, toBlock, erc20: rows.filter((r) => r.token).length, eth: rows.filter((r) => !r.token).length, inserted: count };
}

