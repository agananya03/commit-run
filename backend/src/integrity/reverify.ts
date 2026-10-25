// "Who watches the watchdog": recompute everything from raw inputs and compare it with what the chain holds.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, type JsonRpcProvider } from "ethers";
import type { z } from "zod";
import { encodeActions } from "../chain/actions.js";
import type { DeploymentsT } from "../chain/contracts.js";
import { proposalNumericId, type RegistryClient } from "../chain/registry.js";
import type { SimClient } from "../clients/simClient.js";
import type { ReverifyResult } from "../contracts/schemas.js";
import type { Db } from "../db.js";
import { notFound, HttpError } from "../errors.js";
import { toFinding } from "../proposals/mapping.js";
import { sha256Hex } from "../seed/scenarios.js";
import { findingsForResult, findingsHash } from "../verdict/service.js";
import { readQueuedOperation } from "../watchdog/worker.js";
import { ZERO_HASH } from "./hash.js";
import { buildVersion } from "./versionChain.js";

type ReverifyResultT = z.infer<typeof ReverifyResult>;

export interface ReverifyDeps {
  db: Db;
  sim: SimClient;
  registry: RegistryClient;
  provider: JsonRpcProvider;
  deployments: DeploymentsT;
  repoRoot: string;
}

export class Reverifier {
  constructor(private readonly d: ReverifyDeps) {}

  /**
   * 1. Every version: re-hash the stored evidence files, rebuild canonical JSON + evidence root + versionHash from
   *    scratch (chaining our own recomputed prevHash), and compare with ProposalRegistry's ProposalCommitted logs.
   * 2. The decisive simulation (the flagged run, else the latest queued, else the latest proposed): replay it on its
   *    pinned fork block and compare simHash.
   * 3. Recompute findings from that replay and compare their hash with the one GovernanceGuard.flag() recorded
   *    (or, before any flag, with the stored findings).
   */
  async reverify(idOrSlug: string): Promise<ReverifyResultT> {
    const { db } = this.d;
    const proposal = await db.proposal.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { versions: { orderBy: { version: "asc" }, include: { evidenceFiles: true } } },
    });
    if (!proposal) throw notFound(`Proposal ${idOrSlug} not found`);
    if (proposal.versions.length === 0) throw new HttpError(409, "CONFLICT", `Proposal ${proposal.slug} has no versions to reverify`);

    const onchain = await this.d.registry.commits(proposalNumericId(proposal.slug));
    let prev = ZERO_HASH as string;
    const versions: ReverifyResultT["versions"] = [];
    for (const [i, v] of proposal.versions.entries()) {
      const files = v.evidenceFiles.map((f) => {
        const path = join(this.d.repoRoot, f.uri);
        const bytes = existsSync(path) ? readFileSync(path) : null;
        // A missing or edited file re-hashes differently, so the rebuilt root (and versionHash) diverge.
        return { type: f.type, uri: f.uri, sha256: bytes ? sha256Hex(bytes) : `0x${"0".repeat(64)}`, bytes };
      });
      const onchainFile = files.find((f) => f.type === "onchain");
      let onchainActions: unknown = null;
      try {
        onchainActions = onchainFile?.bytes ? JSON.parse(onchainFile.bytes.toString("utf8")) : null;
      } catch {
        onchainActions = null;
      }
      const rebuilt = buildVersion({ slug: proposal.slug, title: proposal.title, proposer: proposal.proposer, onchainActions }, files.map(({ type, sha256 }) => ({ type, sha256 })), prev);
      prev = rebuilt.versionHash;
      const commit = onchain[i] ?? null;
      const evidenceRootMatch = commit !== null && rebuilt.evidenceRoot === commit.evidenceRoot && rebuilt.evidenceRoot === v.evidenceRoot.toLowerCase();
      versions.push({
        version: v.version,
        versionHash: v.versionHash,
        onchainVersionHash: commit?.versionHash ?? null,
        evidenceRootMatch,
        match: evidenceRootMatch && commit !== null && rebuilt.versionHash === v.versionHash.toLowerCase() && rebuilt.versionHash === commit.versionHash,
      });
    }

    const { simMatch, findingsMatch } = await this.replay(proposal.id);
    return { allMatch: versions.every((v) => v.match) && simMatch && findingsMatch, versions, simMatch, findingsMatch };
  }

  private async replay(proposalId: string): Promise<{ simMatch: boolean; findingsMatch: boolean }> {
    const { db } = this.d;
    const flag = await db.watchdogFlagRecord.findFirst({ where: { proposalId }, orderBy: { flaggedAt: "desc" } });
    const run = flag
      ? await db.simulationRun.findUniqueOrThrow({ where: { id: flag.simulationRunId }, include: { findings: { orderBy: { findingKey: "asc" } } } })
      : ((await db.simulationRun.findFirst({ where: { proposalId, source: "QUEUED" }, orderBy: { createdAt: "desc" }, include: { findings: { orderBy: { findingKey: "asc" } } } })) ??
        (await db.simulationRun.findFirst({ where: { proposalId, source: "PROPOSED" }, orderBy: { createdAt: "desc" }, include: { findings: { orderBy: { findingKey: "asc" } } } })));
    if (!run || !run.proposalVersionId) return { simMatch: false, findingsMatch: false };
    const slug = (await db.proposal.findUniqueOrThrow({ where: { id: proposalId } })).slug;

    // Same payloads as the original run: the queued batch from the chain, or the version's encoded actions.
    let request: { proposalId: string; targets: string[]; values: string[]; calldatas: string[]; forkBlock?: number };
    if (run.source === "QUEUED" && run.operationId) {
      const tl = this.d.deployments.contracts.GuardedTimelock!;
      const op = await readQueuedOperation(this.d.provider, new Contract(tl.address, tl.abi as never, this.d.provider), run.operationId);
      if (!op) return { simMatch: false, findingsMatch: false };
      request = { proposalId: slug, targets: op.targets, values: op.values, calldatas: op.calldatas };
    } else {
      const version = await db.proposalVersion.findUniqueOrThrow({ where: { id: run.proposalVersionId } });
      request = encodeActions((version.canonicalJson as { onchainActions?: unknown }).onchainActions, this.d.deployments, slug);
    }
    if (run.forkBlock !== null) request.forkBlock = run.forkBlock;

    const replayed = await this.d.sim.simulate(request);
    const simMatch = replayed.simHash.toLowerCase() === run.simHash.toLowerCase();
    const recomputed = findingsHash(await findingsForResult(db, replayed, run.proposalVersionId));
    const expected = flag ? flag.findingsHash : findingsHash(run.findings.map(toFinding));
    // With a flag, the reference is what the chain recorded in GovernanceGuard's Flagged event, not our database.
    const onchainFlag = flag ? await this.flaggedHash(run.operationId!) : null;
    const findingsMatch = recomputed.toLowerCase() === expected.toLowerCase() && (onchainFlag === null || onchainFlag === recomputed.toLowerCase());
    return { simMatch, findingsMatch };
  }

  /** findingsHash from the GovernanceGuard Flagged log for an operation (null if none). */
  private async flaggedHash(operationId: string): Promise<string | null> {
    const g = this.d.deployments.contracts.GovernanceGuard!;
    const guard = new Contract(g.address, g.abi as never, this.d.provider);
    const logs = await guard.queryFilter(guard.filters.Flagged!(operationId), 0, "latest");
    const last = logs.at(-1) as unknown as { args?: { findingsHash?: string } } | undefined;
    return last?.args?.findingsHash?.toLowerCase() ?? null;
  }
}
