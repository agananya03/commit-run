// Proposer wallet disclosures: what is signed, how it is verified, and how a stored disclosure file is read.
import { getAddress, isAddress, verifyMessage } from "ethers";
import { z } from "zod";
import { canonicalize } from "../integrity/canonicalize.js";
import { hardhatAddress } from "../seed/scenarios.js";

const Address = z.string().refine((a) => isAddress(a), "expected an address");

/** POST /proposals/:id/disclosure body (DisclosureRequest in /shared/schemas/types.ts). */
export const DisclosureBody = z.strictObject({
  proposer: Address,
  wallets: z.array(Address).max(100),
  statement: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "expected a 65-byte 0x-prefixed signature"),
});
export type DisclosureBodyT = z.infer<typeof DisclosureBody>;

/** What a stored disclosure evidence file contains: the request plus the slug it was signed for. */
export interface SignedDisclosureFile extends DisclosureBodyT {
  proposalSlug: string;
}

const normalize = (wallets: string[]) => [...new Set(wallets.map((w) => getAddress(w).toLowerCase()))].sort();

/**
 * The exact string the proposer signs (EIP-191 personal_sign): RFC 8785 canonical JSON of
 * { proposalSlug, wallets, statement } with wallets lowercased, de-duplicated and sorted.
 */
export function disclosureMessage(proposalSlug: string, wallets: string[], statement: string): string {
  return canonicalize({ proposalSlug, wallets: normalize(wallets), statement });
}

/** Lowercase signer address, or null if the signature is malformed. */
export function recoverDisclosureSigner(proposalSlug: string, d: Pick<DisclosureBodyT, "wallets" | "statement" | "signature">): string | null {
  try {
    return verifyMessage(disclosureMessage(proposalSlug, d.wallets, d.statement), d.signature).toLowerCase();
  } catch {
    return null;
  }
}

export interface ParsedDisclosure {
  /** lowercase, sorted */
  wallets: string[];
  statement: string | null;
  signatureValid: boolean;
  /** Why the signature is not valid, if it is not. */
  problem?: string;
}

/**
 * Reads a disclosure evidence file. Two formats:
 * - signed (written by POST /proposals/:id/disclosure): verified against the proposal's proposer and slug
 * - D's scenario format { proposerIndex, walletIndices, statement }: unsigned, so signatureValid = false
 */
export function parseDisclosure(raw: unknown, proposalSlug: string, proposer: string): ParsedDisclosure {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const signed = DisclosureBody.extend({ proposalSlug: z.string() }).safeParse(obj);
  if (signed.success) {
    const d = signed.data;
    const wallets = normalize(d.wallets);
    if (d.proposalSlug !== proposalSlug) return { wallets, statement: d.statement, signatureValid: false, problem: `signed for ${d.proposalSlug}, not ${proposalSlug}` };
    const signer = recoverDisclosureSigner(proposalSlug, d);
    if (signer !== proposer.toLowerCase()) return { wallets, statement: d.statement, signatureValid: false, problem: `signer ${signer ?? "unknown"} is not the proposer` };
    return { wallets, statement: d.statement, signatureValid: true };
  }

  const fromIndices = Array.isArray(obj.walletIndices) ? obj.walletIndices.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0).map(hardhatAddress) : [];
  // `wallets` may mix addresses and Hardhat indices (test fixtures use indices)
  const fromAddresses = Array.isArray(obj.wallets)
    ? obj.wallets.flatMap((w) => (typeof w === "string" && isAddress(w) ? [w] : Number.isInteger(w) && (w as number) >= 0 ? [hardhatAddress(w as number)] : []))
    : [];
  return {
    wallets: normalize([...fromIndices, ...fromAddresses]),
    statement: typeof obj.statement === "string" ? obj.statement : null,
    signatureValid: false,
    problem: "disclosure is not signed",
  };
}
