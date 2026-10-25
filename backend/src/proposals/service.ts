import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { getAddress, isAddress } from "ethers";
import type { z } from "zod";
import { DecisionSummary, CoiReport, Explanation, IntentSpec, ProposalBundle, RiskChain, SimulationResult } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { Prisma } from "../generated/prisma/client.js";
import { canonicalize } from "../integrity/canonicalize.js";
import { ZERO_HASH } from "../integrity/hash.js";
import { buildVersion, type CanonicalVersion } from "../integrity/versionChain.js";
import { planScenario, sha256Hex, type EvidenceType } from "../seed/scenarios.js";
import { toChainEvent, toFinding, toProposal, toVersion } from "./mapping.js";
import { HttpError } from "../errors.js";
import { proposalNumericId, type RegistryClient } from "../chain/registry.js";
import { DisclosureBody, recoverDisclosureSigner, type SignedDisclosureFile } from "../coi/disclosure.js";
import { saveCoiReport } from "../coi/service.js";

export const EVIDENCE_TYPES: readonly EvidenceType[] = ["forum", "pdf", "social", "onchain", "disclosure"];
const SLUG = /^[A-Z]+-\d+$/;

export interface Upload {
  type: EvidenceType;
  originalName: string;
  bytes: Buffer;
}

interface FileInput {
  type: EvidenceType;
  uri: string;
  sha256: string;
  bytes: number;
}

export interface UploadMeta {
  slug: string;
  title: string;
  proposer: string;
}

export interface ProposalServiceDeps {
  db: Db;
  dataDir: string;
  uploadDir: string;
  repoRoot: string;
  /** On-chain commits; absent in tests that don't need a chain. */
  registry?: RegistryClient;
  /** COI engine for a version (coi/service.ts); absent in tests that don't score COI. */
  coi?: (versionId: string) => Promise<z.infer<typeof CoiReport>>;
}

export interface CommitResultT {
  proposalId: string;
  version: number;
  versionHash: string;
  txHash: string;
  blockNumber: number;
}

type Tx = Prisma.TransactionClient;
type Bundle = z.infer<typeof ProposalBundle>;

export class ProposalService {
  constructor(private readonly deps: ProposalServiceDeps) {}

  async list() {
    const rows = await this.deps.db.proposal.findMany({ orderBy: { slug: "asc" } });
    return rows.map(toProposal);
  }

  /** Full bundle. Analysis sections come from the latest version / latest run and are null until produced. */
  async getBundle(idOrSlug: string): Promise<Bundle> {
    const p = await this.deps.db.proposal.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        versions: { orderBy: { version: "asc" }, include: { evidenceFiles: { orderBy: { type: "asc" } }, summary: true, intentSpec: true, coiReport: true } },
        simulationRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { findings: { orderBy: { findingKey: "asc" } } } },
        riskChains: { orderBy: { createdAt: "desc" }, take: 1 },
        chainEvents: { orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] },
      },
    });
    if (!p) throw notFound(`Proposal ${idOrSlug} not found`);

    const latest = p.versions.at(-1);
    const run = p.simulationRuns[0];
    const json = <S extends z.ZodType>(schema: S, value: unknown): z.infer<S> | null => (value == null ? null : schema.parse(value));
    return {
      proposal: toProposal(p),
      versions: p.versions.map(toVersion),
      summary: json(DecisionSummary, latest?.summary?.data),
      intent: json(IntentSpec, latest?.intentSpec?.data),
      simulation: json(SimulationResult, run?.data),
      coi: json(CoiReport, latest?.coiReport?.data),
      findings: (run?.findings ?? []).map(toFinding),
      explanation: json(Explanation, run?.explanation),
      risk: json(RiskChain, p.riskChains[0]?.data),
      chainEvents: p.chainEvents.map((e) => toChainEvent(e, p.slug)),
      flag: null, // set by the watchdog once GovernanceGuard.flag() is mined
    };
  }

  /** Registers data/scenarios/<slug>/ and seals version 1. */
  async createFromScenario(slug: string): Promise<Bundle> {
    if (!SLUG.test(slug)) throw badRequest(`Invalid slug ${slug}; expected e.g. MIP-21`);
    const dir = join(this.deps.dataDir, "scenarios", slug);
    if (!existsSync(dir)) throw notFound(`No scenario folder for ${slug} in ${this.deps.dataDir}/scenarios`);
    const plan = (() => {
      try {
        return planScenario(dir, slug, this.deps.repoRoot);
      } catch (err) {
        throw badRequest(`Scenario ${slug} is incomplete: ${(err as Error).message}`);
      }
    })();
    await this.deps.db.$transaction(async (tx) => {
      const proposal = await this.upsertNew(tx, { slug, title: plan.title, proposer: plan.proposer });
      await this.sealVersion(tx, proposal, plan.files);
    });
    return this.getBundle(slug);
  }

  /** Registers an uploaded proposal (multipart) and seals version 1. */
  async createFromUpload(meta: UploadMeta, uploads: Upload[]): Promise<Bundle> {
    if (!SLUG.test(meta.slug)) throw badRequest(`Invalid slug ${meta.slug}; expected e.g. MIP-21`);
    if (!isAddress(meta.proposer)) throw badRequest(`proposer must be an address, got ${meta.proposer}`);
    if (uploads.length === 0) throw badRequest("Upload at least one evidence file (fields: forum, pdf, social, onchain, disclosure)");
    const files = uploads.map((u) => this.storeUpload(meta.slug, u));
    await this.deps.db.$transaction(async (tx) => {
      const proposal = await this.upsertNew(tx, { ...meta, proposer: getAddress(meta.proposer).toLowerCase() });
      await this.sealVersion(tx, proposal, files);
    });
    return this.getBundle(meta.slug);
  }

  /**
   * Seals the next version. With uploads, each upload replaces the file of the same type and the rest
   * carry over; without uploads, the scenario folder is re-read (e.g. after editing the PDF).
   */
  async addVersion(idOrSlug: string, uploads: Upload[]) {
    const proposal = await this.deps.db.proposal.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!proposal) throw notFound(`Proposal ${idOrSlug} not found`);

    let files: FileInput[];
    if (uploads.length > 0) {
      const current = await this.currentFiles(proposal.id);
      const byType = new Map(current.map((f) => [f.type, f]));
      for (const u of uploads) byType.set(u.type, this.storeUpload(proposal.slug, u));
      files = [...byType.values()];
    } else {
      const dir = join(this.deps.dataDir, "scenarios", proposal.slug);
      if (!existsSync(dir)) throw badRequest(`No uploads and no scenario folder for ${proposal.slug} to re-read`);
      files = planScenario(dir, proposal.slug, this.deps.repoRoot).files;
    }

    const id = await this.deps.db.$transaction((tx) => this.sealVersion(tx, proposal, files));
    const row = await this.deps.db.proposalVersion.findUniqueOrThrow({ where: { id }, include: { evidenceFiles: { orderBy: { type: "asc" } } } });
    return toVersion(row);
  }

  /**
   * Verifies a signed wallet disclosure, stores it as the version's `disclosure` evidence file (so it enters
   * the evidence Merkle root) and seals a new version. Returns the COI report scored with it.
   */
  async addDisclosure(idOrSlug: string, body: unknown): Promise<z.infer<typeof CoiReport>> {
    const proposal = await this.deps.db.proposal.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
    if (!proposal) throw notFound(`Proposal ${idOrSlug} not found`);
    const d = DisclosureBody.parse(body);
    const proposer = getAddress(d.proposer).toLowerCase();
    if (proposer !== proposal.proposer) throw badRequest(`proposer ${proposer} is not ${proposal.slug}'s proposer ${proposal.proposer}`);
    const signer = recoverDisclosureSigner(proposal.slug, d);
    if (signer !== proposer) {
      throw badRequest(`Signature does not recover to the proposer (recovered ${signer ?? "nothing"}). Sign the canonical JSON of { proposalSlug, wallets (lowercase, sorted), statement } with personal_sign.`, {
        recovered: signer,
        proposer,
      });
    }

    const file: SignedDisclosureFile = { proposalSlug: proposal.slug, proposer, wallets: [...new Set(d.wallets.map((w) => getAddress(w).toLowerCase()))].sort(), statement: d.statement, signature: d.signature };
    const version = await this.addVersion(proposal.id, [{ type: "disclosure", originalName: "disclosure.signed.json", bytes: Buffer.from(canonicalize(file)) }]);
    const row = await this.deps.db.proposalVersion.findUniqueOrThrow({ where: { proposalId_version: { proposalId: proposal.id, version: version.version } } });
    if (!this.deps.coi) throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "COI engine is not configured for this backend");
    const report = await this.deps.coi(row.id);
    await saveCoiReport(this.deps.db, row.id, report);
    return report;
  }

  /**
   * Commits every uncommitted version to ProposalRegistry, oldest first (the registry only accepts a
   * prevHash equal to its latest, so skipping one would revert). Returns the last commit.
   * A version that is already on-chain (e.g. the DB missed the receipt) is recovered from its log.
   */
  async commit(idOrSlug: string): Promise<CommitResultT> {
    const registry = this.deps.registry;
    if (!registry) throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "Chain is not configured for this backend");
    const proposal = await this.deps.db.proposal.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { versions: { orderBy: { version: "asc" } } },
    });
    if (!proposal) throw notFound(`Proposal ${idOrSlug} not found`);
    if (proposal.versions.length === 0) throw conflict(`Proposal ${proposal.slug} has no versions to commit`);
    const pending = proposal.versions.filter((v) => v.commitTxHash === null);
    if (pending.length === 0) {
      const last = proposal.versions.at(-1)!;
      throw conflict(`All ${proposal.versions.length} version(s) of ${proposal.slug} are already committed`, { versionHash: last.versionHash, txHash: last.commitTxHash });
    }

    await registry.assertDeployed();
    const id = proposalNumericId(proposal.slug);
    let result: CommitResultT | null = null;
    for (const v of pending) {
      const onchain = (await registry.latestVersionHash(id)).toLowerCase();
      let receipt;
      if (onchain === v.versionHash.toLowerCase()) {
        receipt = await registry.findCommit(id, v.versionHash);
        if (!receipt) throw new HttpError(409, "CHAIN_REVERT", `Version ${v.version} is the registry's latest but its ProposalCommitted log was not found`);
      } else if (onchain !== v.prevHash.toLowerCase()) {
        throw new HttpError(
          409,
          "CHAIN_REVERT",
          `Stale prevHash for ${proposal.slug} v${v.version}: ProposalRegistry's latest for id ${id} is ${onchain}, but this version links to ${v.prevHash}. ` +
            "The database and the chain disagree (chain reset, or committed elsewhere); reset one side or rebuild the version chain.",
          { onchainLatest: onchain, expectedPrevHash: v.prevHash, version: v.version },
        );
      } else {
        receipt = await registry.commit({ proposalNumericId: id, versionHash: v.versionHash, prevHash: v.prevHash, evidenceRoot: v.evidenceRoot, uri: `poi://${proposal.slug}/v${v.version}` });
      }
      await this.deps.db.proposalVersion.update({ where: { id: v.id }, data: { commitTxHash: receipt.txHash } });
      result = { proposalId: proposal.id, version: v.version, versionHash: v.versionHash, txHash: receipt.txHash, blockNumber: receipt.blockNumber };
    }
    if (proposal.status === "DRAFT" || proposal.status === "INGESTED") {
      await this.deps.db.proposal.update({ where: { id: proposal.id }, data: { status: "COMMITTED" } });
    }
    return result!;
  }

  // --- internals --------------------------------------------------------------

  private async upsertNew(tx: Tx, meta: UploadMeta) {
    const existing = await tx.proposal.findUnique({ where: { slug: meta.slug }, include: { _count: { select: { versions: true } } } });
    if (existing && existing._count.versions > 0) {
      throw conflict(`Proposal ${meta.slug} already exists; use POST /proposals/${meta.slug}/versions for a new version`);
    }
    return tx.proposal.upsert({
      where: { slug: meta.slug },
      create: meta,
      update: { title: meta.title, proposer: meta.proposer },
    });
  }

  /** Files of the latest version, or the staged files if there is no version yet. */
  private async currentFiles(proposalId: string): Promise<FileInput[]> {
    const latest = await this.deps.db.proposalVersion.findFirst({ where: { proposalId }, orderBy: { version: "desc" }, include: { evidenceFiles: true } });
    const rows = latest ? latest.evidenceFiles : await this.deps.db.evidenceFile.findMany({ where: { proposalId, proposalVersionId: null } });
    return rows.map((f) => ({ type: f.type, uri: f.uri, sha256: f.sha256, bytes: f.bytes }));
  }

  /** Builds the next link of the hash chain and stores it with its (frozen) evidence files. */
  private async sealVersion(tx: Tx, proposal: { id: string; slug: string; title: string; proposer: string }, files: FileInput[]): Promise<string> {
    const latest = await tx.proposalVersion.findFirst({ where: { proposalId: proposal.id }, orderBy: { version: "desc" } });
    const built = buildVersion(
      { slug: proposal.slug, title: proposal.title, proposer: proposal.proposer, onchainActions: this.readOnchainActions(files) },
      files,
      latest?.versionHash ?? ZERO_HASH,
    );
    if (latest && sameContent(latest.canonicalJson as unknown as CanonicalVersion, built.canonicalJson)) {
      throw conflict(`No changes since version ${latest.version}; nothing to seal`, { versionHash: latest.versionHash });
    }

    await tx.evidenceFile.deleteMany({ where: { proposalId: proposal.id, proposalVersionId: null } });
    const version = await tx.proposalVersion.create({
      data: {
        proposalId: proposal.id,
        version: (latest?.version ?? 0) + 1,
        canonicalJson: built.canonicalJson as unknown as Prisma.InputJsonValue,
        versionHash: built.versionHash,
        prevHash: built.prevHash,
        evidenceRoot: built.evidenceRoot,
        evidenceFiles: {
          create: files.map((f) => ({ proposalId: proposal.id, type: f.type, uri: f.uri, sha256: f.sha256.toLowerCase(), bytes: f.bytes })),
        },
      },
    });
    return version.id;
  }

  /** onchain_actions.json content goes into the canonical version (null if absent or not JSON). */
  private readOnchainActions(files: FileInput[]): unknown {
    const onchain = files.find((f) => f.type === "onchain");
    if (!onchain) return null;
    try {
      return JSON.parse(readFileSync(join(this.deps.repoRoot, onchain.uri), "utf8"));
    } catch {
      return null;
    }
  }

  /** Content-addressed: <uploadDir>/<slug>/<sha12>-<name>; identical bytes are stored once. */
  private storeUpload(slug: string, u: Upload): FileInput {
    const sha256 = sha256Hex(u.bytes);
    const safeName = u.originalName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || u.type;
    const dir = join(this.deps.uploadDir, slug);
    const path = join(dir, `${sha256.slice(2, 14)}-${safeName}`);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(path)) writeFileSync(path, u.bytes);
    return { type: u.type, uri: relative(this.deps.repoRoot, path).split(sep).join("/"), sha256, bytes: u.bytes.length };
  }
}

/** Same version content apart from prevHash (which always differs between links). */
function sameContent(a: CanonicalVersion, b: CanonicalVersion): boolean {
  const strip = ({ prevHash: _p, ...rest }: CanonicalVersion) => rest;
  return canonicalize(strip(a)) === canonicalize(strip(b));
}
