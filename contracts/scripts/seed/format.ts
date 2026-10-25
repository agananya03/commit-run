import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

/**
 * Seed data format expected in /data (owned by teammate D). Documented in contracts/README.md.
 * Unknown extra fields are ignored, so D can add notes or labels freely.
 */

/** Hardhat account index under the default mnemonic (hardhat.config.ts creates 80). */
const AccountIndex = z.number().int().min(0).max(79);
/** Human units as a decimal string, e.g. "1500000" or "2.5". */
const Amount = z.string().regex(/^\d+(\.\d+)?$/, "amount must be a decimal string like \"1500\" or \"2.5\"");

export const WalletsFile = z.object({
  wallets: z
    .array(
      z.object({
        index: AccountIndex,
        role: z.string().min(1),
        label: z.string().optional(),
        /** MRD sent from the deployer at seed time (whole tokens). */
        mrd: Amount.optional(),
        /** USDC minted to this account at seed time. */
        usdc: Amount.optional(),
        /** Account index to delegate MRD voting power to; defaults to self. Only used when mrd is set. */
        delegateTo: AccountIndex.optional(),
      }),
    )
    .refine((ws) => new Set(ws.map((w) => w.index)).size === ws.length, "wallet indexes must be unique"),
});

export const TransfersFile = z.object({
  transfers: z.array(
    z.object({
      from: AccountIndex,
      to: AccountIndex,
      token: z.enum(["ETH", "USDC", "MRD"]),
      amount: Amount,
      /** Blocks after the replay starts; transfers are replayed in this order and empty blocks are mined between them. */
      blockOffset: z.number().int().min(0),
      /** Optional exact block time (ISO 8601). Must be later than the chain's latest block. */
      timestamp: z.iso.datetime({ offset: true }).optional(),
    }),
  ),
});

export type Wallets = z.infer<typeof WalletsFile>["wallets"];
export type Transfers = z.infer<typeof TransfersFile>["transfers"];

export interface SeedData {
  wallets: Wallets;
  transfers: Transfers;
  /** Where each file came from, for the deploy log. */
  sources: { wallets: string; transfers: string };
  usedFallback: boolean;
}

const DATA_DIR = resolve(__dirname, "../../../data");
const FALLBACK_DIR = __dirname;

function load<T extends z.ZodType>(schema: T, primary: string, fallback: string): { value: z.infer<T>; source: string; fallback: boolean } {
  const path = existsSync(primary) ? primary : fallback;
  const parsed = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid seed file ${path}:\n${z.prettifyError(parsed.error)}`);
  }
  return { value: parsed.data, source: path, fallback: path === fallback };
}

/** Reads /data/wallets.json and /data/transfers.json (or SEED_WALLETS / SEED_TRANSFERS), else the bundled fallback. */
export function loadSeedData(): SeedData {
  const wallets = load(WalletsFile, process.env.SEED_WALLETS ?? join(DATA_DIR, "wallets.json"), join(FALLBACK_DIR, "fallback-wallets.json"));
  const transfers = load(TransfersFile, process.env.SEED_TRANSFERS ?? join(DATA_DIR, "transfers.json"), join(FALLBACK_DIR, "fallback-transfers.json"));
  return {
    wallets: wallets.value.wallets,
    transfers: transfers.value.transfers,
    sources: { wallets: wallets.source, transfers: transfers.source },
    usedFallback: wallets.fallback || transfers.fallback,
  };
}
