// Loads what the COI engine needs for one proposal version from the database and runs it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ZeroAddress } from "ethers";
import type { z } from "zod";
import type { DeploymentsT } from "../chain/contracts.js";
import { IntentSpec, SimulationResult, type CoiReport } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import type { Prisma } from "../generated/prisma/client.js";
import { COI_CONFIG, computeCoi, type CoiConfig, type CoiInput, type TargetRole } from "./graph.js";
import { parseDisclosure, type ParsedDisclosure } from "./disclosure.js";

type IntentT = z.infer<typeof IntentSpec>;
type SimT = z.infer<typeof SimulationResult>;

/** Recipients the proposal moves value or power to, according to the text and to the simulation. */
export function targetsOf(intent: IntentT | null, sim: SimT | null): { address: string; role: TargetRole }[] {
  const out: { address: string; role: TargetRole }[] = [];
  for (const a of intent?.actions ?? []) if (a.recipient) out.push({ address: a.recipient, role: "recipient" });
  for (const t of sim?.tokenTransfers ?? []) out.push({ address: t.to, role: "recipient" });
  for (const a of sim?.approvals ?? []) out.push({ address: a.spender, role: "spender" });
  for (const o of sim?.ownershipChanges ?? []) out.push({ address: o.after, role: "new owner" });
  return out.filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t.address));
}

/** Top voters by weight from the Governor's VoteCast events (args are stored as JSON strings). */
export function topVoters(events: { args: unknown }[], n: number): string[] {
  const weight = new Map<string, bigint>();
  for (const e of events) {
    const args = e.args as { voter?: unknown; weight?: unknown };
    if (typeof args.voter !== "string") continue;
    const w = BigInt(typeof args.weight === "string" || typeof args.weight === "number" ? args.weight : 0);
    weight.set(args.voter.toLowerCase(), (weight.get(args.voter.toLowerCase()) ?? 0n) + w);
  }
  return [...weight.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0].localeCompare(b[0]))).slice(0, n).map(([v]) => v);
}

export interface CoiContext {
  input: CoiInput;
  disclosure: ParsedDisclosure | null;
}

export interface CoiLoadOptions {
  db: Db;
  deployments: DeploymentsT;
  repoRoot: string;
  config?: CoiConfig;
}

/**
 * Builds the engine input for a version. Intent and simulation come from that version, else the
 * proposal's latest ones; a disclosure can be passed in to score one before it is stored.
 */
export async function loadCoiContext(opts: CoiLoadOptions, versionId: string, override?: { disclosure: ParsedDisclosure }): Promise<CoiContext> {
  const { db, deployments, repoRoot } = opts;
  const config = opts.config ?? COI_CONFIG;
  const version = await db.proposalVersion.findUniqueOrThrow({ where: { id: versionId }, include: { proposal: true, evidenceFiles: true, intentSpec: true } });
  const { proposal } = version;

  let disclosure = override?.disclosure ?? null;
  const file = version.evidenceFiles.find((f) => f.type === "disclosure");
  if (!disclosure && file && existsSync(join(repoRoot, file.uri))) {
    try {
      disclosure = parseDisclosure(JSON.parse(readFileSync(join(repoRoot, file.uri), "utf8")), proposal.slug, proposal.proposer);
    } catch {
      disclosure = { wallets: [], statement: null, signatureValid: false, problem: "disclosure file is not valid JSON" };
    }
  }

  const intentRow = version.intentSpec ?? (await db.intentSpecRecord.findFirst({ where: { proposalVersion: { proposalId: proposal.id } }, orderBy: { createdAt: "desc" } }));
  const simRow =
    (await db.simulationRun.findFirst({ where: { proposalVersionId: versionId, source: "PROPOSED" }, orderBy: { createdAt: "desc" } })) ??
    (await db.simulationRun.findFirst({ where: { proposalId: proposal.id }, orderBy: { createdAt: "desc" } }));
  const intent = intentRow ? IntentSpec.parse(intentRow.data) : null;
  const sim = simRow ? SimulationResult.parse(simRow.data) : null;

  const [votes, created, transfers, wallets, latest] = await Promise.all([
    db.chainEvent.findMany({ where: { proposalId: proposal.id, contract: "MeridianGovernor", name: "VoteCast" }, select: { args: true } }),
    db.chainEvent.findFirst({ where: { proposalId: proposal.id, contract: "MeridianGovernor", name: "ProposalCreated" }, orderBy: { blockNumber: "asc" } }),
    db.transfer.findMany({ select: { from: true, to: true, token: true, amount: true, blockNumber: true, logIndex: true } }),
    db.wallet.findMany({ where: { label: { not: null } } }),
    db.transfer.aggregate({ _max: { blockNumber: true } }),
  ]);

  const contracts = Object.values(deployments.contracts).map((c) => c.address.toLowerCase());
  const tokens: Record<string, { symbol: string; decimals: number }> = {};
  for (const [name, c] of Object.entries(deployments.contracts)) {
    if (name === "MeridianToken") tokens[c.address.toLowerCase()] = { symbol: "MRD", decimals: c.decimals ?? 18 };
    if (name === "MockUSDC") tokens[c.address.toLowerCase()] = { symbol: "USDC", decimals: c.decimals ?? 6 };
  }

  const input: CoiInput = {
    proposalId: proposal.slug,
    proposer: proposal.proposer,
    claimed: disclosure?.wallets ?? [],
    signatureValid: disclosure?.signatureValid ?? false,
    targets: [...targetsOf(intent, sim), ...topVoters(votes, config.topVoters).map((address) => ({ address, role: "voter" as const }))],
    transfers: transfers.map((t) => ({ ...t, amount: t.amount.toFixed(0) })),
    // Before the proposal is on-chain, "now" (the latest imported block) is the reference.
    referenceBlock: created?.blockNumber ?? latest._max.blockNumber ?? 0,
    ignore: [ZeroAddress, ...contracts],
    // D's labels carry a persona blurb in parentheses; reasons only need the name
    labels: Object.fromEntries(wallets.map((w) => [w.address, w.label!.split(" (")[0]!])),
    tokens,
  };
  return { input, disclosure };
}

export async function coiReportFor(opts: CoiLoadOptions, versionId: string, override?: { disclosure: ParsedDisclosure }): Promise<z.infer<typeof CoiReport>> {
  const { input } = await loadCoiContext(opts, versionId, override);
  return computeCoi(input, opts.config ?? COI_CONFIG);
}

/** Stores (or replaces) a version's COI report; the engine is deterministic, so re-running it is safe. */
export async function saveCoiReport(db: Db, versionId: string, report: z.infer<typeof CoiReport>): Promise<void> {
  const row = { data: report as unknown as Prisma.InputJsonValue, pCoi: report.pCoi, signatureValid: report.signatureValid, undisclosedLinks: report.undisclosedLinks.length };
  await db.coiReportRecord.upsert({ where: { proposalVersionId: versionId }, create: { proposalVersionId: versionId, ...row }, update: row });
}
