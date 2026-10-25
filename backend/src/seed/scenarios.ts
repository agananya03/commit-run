import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { getAddress, HDNodeWallet, isAddress } from "ethers";

export type EvidenceType = "forum" | "pdf" | "social" | "onchain" | "disclosure";

/**
 * Scenario file name -> evidence type. Not evidence on purpose:
 * votes.json (votes are read from the chain) and expected.json (the answer key must never
 * enter the evidence trail it is used to grade).
 */
export const EVIDENCE_FILES: Readonly<Record<string, EvidenceType>> = {
  "forum_thread.json": "forum",
  "proposal.pdf": "pdf",
  "social.json": "social",
  "onchain_actions.json": "onchain",
  "disclosure.json": "disclosure",
};

const SLUG = /^MIP-\d+$/;
const HARDHAT_MNEMONIC = "test test test test test test test test test test test junk";

export interface EvidencePlan {
  type: EvidenceType;
  /** Repo-relative path with forward slashes, e.g. data/scenarios/MIP-21/proposal.pdf */
  uri: string;
  /** 0x-prefixed sha256 of the file bytes */
  sha256: string;
  bytes: number;
}

export interface ScenarioPlan {
  slug: string;
  title: string;
  /** lowercase address */
  proposer: string;
  files: EvidencePlan[];
}

export interface LoadResult {
  plans: ScenarioPlan[];
  errors: { slug: string; message: string }[];
}

export const sha256Hex = (bytes: Buffer): string => `0x${createHash("sha256").update(bytes).digest("hex")}`;

/** Address of default Hardhat account #index (the wallet universe refers to accounts by index). */
export function hardhatAddress(index: number): string {
  return HDNodeWallet.fromPhrase(HARDHAT_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).address;
}

/** Accepts an address, a Hardhat account index, or { address } / { index }. Returns lowercase or null. */
function toAddress(value: unknown): string | null {
  if (typeof value === "string" && isAddress(value)) return getAddress(value).toLowerCase();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return hardhatAddress(value).toLowerCase();
  if (value !== null && typeof value === "object") {
    const v = value as { address?: unknown; index?: unknown };
    return toAddress(v.address) ?? toAddress(v.index);
  }
  return null;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

export function resolveTitle(forum: Record<string, unknown> | null, slug: string): string {
  const topic = forum?.topic as { title?: unknown } | undefined;
  const title = forum?.title ?? topic?.title;
  return typeof title === "string" && title.trim() ? title.trim() : slug;
}

/** Proposer from disclosure.json, then onchain_actions.json: field `proposer` or `proposerIndex` (D's format). */
export function resolveProposer(dir: string): string | null {
  for (const file of ["disclosure.json", "onchain_actions.json"]) {
    const json = readJson(join(dir, file));
    if (!json || Array.isArray(json)) continue;
    const address = toAddress(json.proposer) ?? toAddress(json.proposerIndex);
    if (address) return address;
  }
  return null;
}

export function planScenario(dir: string, slug: string, repoRoot: string): ScenarioPlan {
  const proposer = resolveProposer(dir);
  if (!proposer) {
    throw new Error("no proposer found: add a `proposer` address or Hardhat index to disclosure.json or onchain_actions.json");
  }
  const files: EvidencePlan[] = [];
  for (const [name, type] of Object.entries(EVIDENCE_FILES)) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    files.push({ type, uri: relative(repoRoot, path).split(sep).join("/"), sha256: sha256Hex(bytes), bytes: bytes.length });
  }
  if (files.length === 0) throw new Error("no evidence files found");
  return { slug, title: resolveTitle(readJson(join(dir, "forum_thread.json")), slug), proposer, files };
}

/** Reads <dataDir>/scenarios/MIP-*\/ into seed plans. Missing folder = no scenarios, not an error. */
export function loadScenarios(dataDir: string, repoRoot: string): LoadResult {
  const root = join(dataDir, "scenarios");
  const result: LoadResult = { plans: [], errors: [] };
  if (!existsSync(root)) return result;

  const slugs = readdirSync(root).filter((name) => SLUG.test(name) && statSync(join(root, name)).isDirectory()).sort();
  for (const slug of slugs) {
    try {
      result.plans.push(planScenario(join(root, slug), slug, repoRoot));
    } catch (err) {
      result.errors.push({ slug, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
