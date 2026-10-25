import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { getAddress, isAddress } from "ethers";
import type { z } from "zod";
import { DecisionSummary, CoiReport, IntentSpec, ProposalBundle, RiskChain, SimulationResult } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { Prisma } from "../generated/prisma/client.js";
import { canonicalize } from "../integrity/canonicalize.js";
import { ZERO_HASH } from "../integrity/hash.js";
import { buildVersion, type CanonicalVersion } from "../integrity/versionChain.js";
import { planScenario, sha256Hex, type EvidenceType } from "../seed/scenarios.js";
import { toChainEvent, toFinding, toProposal, toVersion } from "./mapping.js";

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
      explanation: null, // stored once /explain is wired into the verdict step
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
