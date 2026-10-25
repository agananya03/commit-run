import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ethers } from "ethers";
import { z } from "zod";

/**
 * Seed data format in /data (owned by teammate D, produced by data/gen_wallets.py). Documented in
 * contracts/README.md. Unknown extra fields (synthetic, id, notes...) are ignored.
 */

/** Hardhat account index under the default mnemonic (hardhat.config.ts creates 80). */
const AccountIndex = z.number().int().min(0).max(79);
/** Whole tokens as a JSON number or decimal string, e.g. 1500000 or "2.5". */
const WholeTokens = z.union([
  z.number().nonnegative().refine(Number.isSafeInteger, "use a whole number (or a decimal string for fractions)"),
  z.string().regex(/^\d+(\.\d+)?$/, 'amount must look like "1500" or "2.5"'),
]);
/** Base units as an integer string: 6 decimals for USDC, 18 for MRD and ETH. */
const BaseUnits = z.string().regex(/^\d+$/, "amount must be an integer string in base units");

export const WalletsFile = z.object({
  wallets: z
    .array(
      z.object({
        index: AccountIndex,
        role: z.string().min(1),
        label: z.string().optional(),
        /** MRD sent from the deployer at seed time (whole tokens). */
        mrd: WholeTokens.optional(),
        /** USDC minted to this account at seed time (whole tokens). */
        usdc: WholeTokens.optional(),
        /** Account index to delegate MRD voting power to; defaults to self. Only used when mrd > 0. */
        delegateTo: AccountIndex.optional(),
      }),
    )
    .refine((ws) => new Set(ws.map((w) => w.index)).size === ws.length, "wallet indexes must be unique"),
});

export const TransfersFile = z.object({
  transfers: z.array(
    z.object({
      id: z.string().optional(),
      fromIndex: AccountIndex,
      toIndex: AccountIndex,
      token: z.enum(["ETH", "USDC", "MRD"]),
      amount: BaseUnits,
      /** Blocks after the replay starts; transfers are replayed in this order and empty blocks are mined between them. */
      blockOffset: z.number().int().min(0),
      /** Optional exact block time (ISO 8601). Must be later than the chain's latest block. */
      timestamp: z.iso.datetime({ offset: true }).optional(),
    }),
  ),
});

export type Token = "ETH" | "USDC" | "MRD";

export interface SeedWallet {
  index: number;
  role: string;
  label?: string;
  /** MRD to send from the deployer, in wei. */
  mrd: bigint;
  /** USDC to mint, in base units (6 decimals). */
  usdc: bigint;
  delegateTo?: number;
}

export interface SeedTransfer {
  /** Position in the file (stable tie-break for equal blockOffsets). */
  i: number;
  id?: string;
  from: number;
  to: number;
  token: Token;
  /** Base units. */
  amount: bigint;
  blockOffset: number;
  timestamp?: string;
}

/**
 * Balances the data assumes but never creates (e.g. a hub sending USDC it never received).
 * USDC is minted to the account; MRD comes from the deployer, held back from `mrdHeldBackFrom`.
 */
export interface Prefunding {
  usdc: Map<number, bigint>;
  mrd: Map<number, bigint>;
  mrdHeldBackFrom: number | null;
}

export interface SeedData {
  wallets: SeedWallet[];
  /** Sorted in replay order. */
  transfers: SeedTransfer[];
  prefunding: Prefunding;
  /** Where each file came from, for the deploy log. */
  sources: { wallets: string; transfers: string };
  usedFallback: boolean;
}

export const DECIMALS: Record<Token, number> = { ETH: 18, USDC: 6, MRD: 18 };
const toUnits = (v: number | string | undefined, decimals: number): bigint => (v === undefined ? 0n : ethers.parseUnits(String(v), decimals));

/** Every Hardhat account starts with this much ETH; generous enough that gas never matters here. */
const HARDHAT_ETH = ethers.parseEther("10000");

/**
 * Replays the transfers on paper (same order as the chain replay) and returns what each sender is
 * missing at the moment it sends. Pure, so it can be unit-tested and run before touching the chain.
 */
export function shortfalls(wallets: SeedWallet[], transfers: SeedTransfer[]): Record<Token, Map<number, bigint>> {
  const bal: Record<Token, bigint[]> = {
    ETH: Array.from({ length: 80 }, () => HARDHAT_ETH),
    USDC: Array.from({ length: 80 }, () => 0n),
    MRD: Array.from({ length: 80 }, () => 0n),
  };
  for (const w of wallets) {
    if (w.index !== 0) bal.MRD[w.index]! += w.mrd;
    bal.USDC[w.index]! += w.usdc;
  }
  const out: Record<Token, Map<number, bigint>> = { ETH: new Map(), USDC: new Map(), MRD: new Map() };
  for (const t of transfers) {
    const b = bal[t.token];
    const have = b[t.from]!;
    if (have < t.amount) {
      out[t.token].set(t.from, (out[t.token].get(t.from) ?? 0n) + (t.amount - have));
      b[t.from] = t.amount;
    }
    b[t.from]! -= t.amount;
    b[t.to]! += t.amount;
  }
  return out;
}

/** Plans pre-funding so the replay cannot run dry; the deployer's MRD budget is the fixed 100M supply. */
export function planPrefunding(wallets: SeedWallet[], transfers: SeedTransfer[], totalMrd: bigint): Prefunding {
  const first = shortfalls(wallets, transfers);
  if (first.ETH.size > 0) throw new Error(`seed data sends more ETH than an account holds: ${[...first.ETH.keys()].join(", ")}`);

  const mrdNeeded = [...first.MRD.values()].reduce((s, x) => s + x, 0n);
  const handedOut = wallets.filter((w) => w.index !== 0).reduce((s, w) => s + w.mrd, 0n);
  const spare = totalMrd - handedOut;
  let heldBackFrom: number | null = null;
  if (mrdNeeded > spare) {
    // Take the difference out of the largest allocation (smallest relative change to anyone's voting power).
    const largest = wallets.filter((w) => w.index !== 0).sort((a, b) => (b.mrd > a.mrd ? 1 : b.mrd < a.mrd ? -1 : a.index - b.index))[0];
    if (!largest || largest.mrd < mrdNeeded - spare) throw new Error("not enough MRD supply to cover the seed data");
    largest.mrd -= mrdNeeded - spare;
    heldBackFrom = largest.index;
  }

  // Re-check with the adjusted allocation and the pre-funding applied.
  const funded = wallets.map((w) => ({ ...w, usdc: w.usdc + (first.USDC.get(w.index) ?? 0n), mrd: w.mrd + (first.MRD.get(w.index) ?? 0n) }));
  for (const i of [...first.USDC.keys(), ...first.MRD.keys()]) {
    if (!funded.some((w) => w.index === i)) funded.push({ index: i, role: "unlisted", mrd: first.MRD.get(i) ?? 0n, usdc: first.USDC.get(i) ?? 0n });
  }
  const again = shortfalls(funded, transfers);
  if (again.USDC.size + again.MRD.size > 0) throw new Error("pre-funding plan is inconsistent; check the seed data");

  return { usdc: first.USDC, mrd: first.MRD, mrdHeldBackFrom: heldBackFrom };
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
export function loadSeedData(totalMrd: bigint): SeedData {
  const w = load(WalletsFile, process.env.SEED_WALLETS ?? join(DATA_DIR, "wallets.json"), join(FALLBACK_DIR, "fallback-wallets.json"));
  const t = load(TransfersFile, process.env.SEED_TRANSFERS ?? join(DATA_DIR, "transfers.json"), join(FALLBACK_DIR, "fallback-transfers.json"));

  const wallets: SeedWallet[] = w.value.wallets.map((x) => ({
    index: x.index,
    role: x.role,
    ...(x.label !== undefined ? { label: x.label } : {}),
    mrd: toUnits(x.mrd, DECIMALS.MRD),
    usdc: toUnits(x.usdc, DECIMALS.USDC),
    ...(x.delegateTo !== undefined ? { delegateTo: x.delegateTo } : {}),
  }));
  const transfers: SeedTransfer[] = t.value.transfers
    .map((x, i) => ({
      i,
      ...(x.id !== undefined ? { id: x.id } : {}),
      from: x.fromIndex,
      to: x.toIndex,
      token: x.token,
      amount: BigInt(x.amount),
      blockOffset: x.blockOffset,
      ...(x.timestamp !== undefined ? { timestamp: x.timestamp } : {}),
    }))
    .sort((a, b) => a.blockOffset - b.blockOffset || a.i - b.i);

  return {
    wallets,
    transfers,
    prefunding: planPrefunding(wallets, transfers, totalMrd),
    sources: { wallets: w.source, transfers: t.source },
    usedFallback: w.fallback || t.fallback,
  };
}
