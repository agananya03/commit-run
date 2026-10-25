import { Contract, Interface, keccak256, toBeHex, toUtf8Bytes, ZeroHash, type JsonRpcProvider, type Log, type LogDescription } from "ethers";
import type { Logger } from "pino";
import type { Db } from "../db.js";
import type { EventBus } from "../events.js";
import type { Prisma, ProposalStatus } from "../generated/prisma/client.js";
import { encodeActions } from "./actions.js";
import type { DeploymentsT } from "./contracts.js";
import { importTransfers } from "./transfers.js";

/** Contracts and events the listener stores (anything else they emit is ignored). */
const WATCHED: Record<string, readonly string[]> = {
  MeridianGovernor: ["ProposalCreated", "VoteCast", "ProposalQueued", "ProposalExecuted", "ProposalCanceled"],
  GuardedTimelock: ["CallScheduled", "CallExecuted"],
  GovernanceGuard: ["Flagged", "Cleared"],
  ProposalRegistry: ["ProposalCommitted"],
};
const LOG_RANGE = 2000;

export interface ListenerOptions {
  db: Db;
  provider: JsonRpcProvider;
  deployments: DeploymentsT;
  bus?: EventBus;
  logger: Pick<Logger, "info" | "warn" | "error">;
  pollMs?: number;
  /** Every GuardedTimelock CallScheduled (live or backfilled); the watchdog dedupes per operation. */
  onCallScheduled?: (operationId: string) => void;
}

interface Watched {
  name: string;
  iface: Interface;
  events: Set<string>;
}

/** JSON-safe event args: bigints -> decimal strings, nested arrays kept, named keys only. */
function argsToJson(desc: LogDescription): Record<string, unknown> {
  const conv = (v: unknown): unknown => (typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(conv) : v);
  const out: Record<string, unknown> = {};
  desc.fragment.inputs.forEach((input, i) => {
    out[input.name || `arg${i}`] = conv(desc.args[i]);
  });
  return out;
}

const lower = (s: string): string => s.toLowerCase();

/**
 * Backfills every watched event and transfer from block 0, then polls for new blocks. Events are stored as
 * ChainEvent (unique on txHash + logIndex, so replays are no-ops), applied to Proposal.status in block order,
 * and emitted as chain:event when they arrive live. A chain reset (latest block below the cursor) triggers a
 * fresh backfill.
 */
export class ChainListener {
  private readonly byAddress = new Map<string, Watched>();
  private cursor = -1;
  private timer: NodeJS.Timeout | undefined;
  private busy = false;
  private downLogged = false;

  constructor(private readonly opts: ListenerOptions) {
    for (const [name, events] of Object.entries(WATCHED)) {
      const entry = opts.deployments.contracts[name];
      if (entry) this.byAddress.set(lower(entry.address), { name, iface: new Interface(entry.abi as never), events: new Set(events) });
    }
  }

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs ?? 1000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One poll: process blocks (cursor, latest]. Safe to call concurrently (later calls are skipped). */
  async tick(): Promise<{ from: number; to: number } | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      // Ask the node directly: provider.getBlockNumber() is cached and can lag a just-mined block.
      const latest = Number(await this.opts.provider.send("eth_blockNumber", []));
      if (this.downLogged) {
        this.opts.logger.info({ latest }, "chain RPC reachable again");
        this.downLogged = false;
      }
      if (latest < this.cursor) {
        this.opts.logger.warn({ latest, cursor: this.cursor }, "chain head went backwards (node restarted?); re-backfilling");
        this.cursor = -1;
      }
      if (latest <= this.cursor) return null;
      const backfill = this.cursor === -1;
      const from = this.cursor + 1;
      await this.processRange(from, latest, !backfill);
      this.cursor = latest;
      if (backfill) this.opts.logger.info({ toBlock: latest }, "chain backfill complete");
      return { from, to: latest };
    } catch (err) {
      if (!this.downLogged) {
        this.opts.logger.warn({ err: (err as Error).message.split("\n")[0] }, "chain listener cannot reach the RPC; retrying");
        this.downLogged = true;
      }
      return null;
    } finally {
      this.busy = false;
    }
  }

  private async processRange(from: number, to: number, live: boolean): Promise<void> {
    const transfers = await importTransfers(this.opts.db, this.opts.provider, this.opts.deployments, from, to);
    if (!live && transfers.inserted > 0) this.opts.logger.info(transfers, "imported transfers");

    const addresses = [...this.byAddress.keys()];
    for (let start = from; start <= to; start += LOG_RANGE) {
      const end = Math.min(start + LOG_RANGE - 1, to);
      const logs = await this.opts.provider.getLogs({ address: addresses, fromBlock: start, toBlock: end });
      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      for (const log of logs) await this.handle(log, live);
    }
  }

  private async handle(log: Log, live: boolean): Promise<void> {
    const watched = this.byAddress.get(lower(log.address));
    if (!watched) return;
    let desc: LogDescription | null = null;
    try {
      desc = watched.iface.parseLog(log);
    } catch {
      return;
    }
    if (!desc || !watched.events.has(desc.name)) return;

    const args = argsToJson(desc);
    const proposal = await this.applyEffects(watched.name, desc, log);
    const block = await this.opts.provider.getBlock(log.blockNumber);
    const created = await this.opts.db.chainEvent.createMany({
      data: [{
        proposalId: proposal?.id ?? null,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.index,
        contract: watched.name,
        address: lower(log.address),
        name: desc.name,
        args: args as Prisma.InputJsonValue,
        timestamp: block ? new Date(block.timestamp * 1000) : null,
      }],
      skipDuplicates: true,
    });
    if (watched.name === "GuardedTimelock" && desc.name === "CallScheduled") this.opts.onCallScheduled?.(lower(desc.args.id as string));
    if (live && created.count > 0) {
      this.opts.bus?.emit("chain:event", {
        proposalId: proposal?.slug ?? null,
        contract: watched.name,
        name: desc.name,
        args,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.index,
      });
    }
  }

  /** Links the event to one of our proposals and moves Proposal.status. Idempotent, so replays are harmless. */
  private async applyEffects(contract: string, d: LogDescription, log: Log): Promise<{ id: string; slug: string } | null> {
    const db = this.opts.db;
    const byGovernorId = (id: bigint) => db.proposal.findFirst({ where: { governorProposalId: id.toString() }, select: { id: true, slug: true } });
    const byOperation = (opId: string) => db.proposal.findFirst({ where: { operationId: lower(opId) }, select: { id: true, slug: true } });
    const setStatus = async (p: { id: string } | null, status: ProposalStatus, onlyFrom?: ProposalStatus[]) => {
      if (!p) return;
      await db.proposal.updateMany({ where: { id: p.id, ...(onlyFrom ? { status: { in: onlyFrom } } : {}) }, data: { status } });
    };

    switch (`${contract}.${d.name}`) {
      case "MeridianGovernor.ProposalCreated":
        return this.linkProposal(d, log);
      case "MeridianGovernor.VoteCast":
        return byGovernorId(d.args.proposalId as bigint);
      case "MeridianGovernor.ProposalQueued": {
        const p = await byGovernorId(d.args.proposalId as bigint);
        await setStatus(p, "QUEUED");
        return p;
      }
      case "MeridianGovernor.ProposalExecuted": {
        const p = await byGovernorId(d.args.proposalId as bigint);
        await setStatus(p, "EXECUTED");
        return p;
      }
      case "MeridianGovernor.ProposalCanceled": {
        const p = await byGovernorId(d.args.proposalId as bigint);
        await setStatus(p, "DEFEATED"); // no CANCELED status in the schema; a canceled proposal will not execute either
        return p;
      }
      case "GuardedTimelock.CallScheduled":
      case "GuardedTimelock.CallExecuted":
        return byOperation(d.args.id as string);
      case "GovernanceGuard.Flagged": {
        const p = await byOperation(d.args.operationId as string);
        await setStatus(p, "HALTED");
        return p;
      }
      case "GovernanceGuard.Cleared": {
        const p = await byOperation(d.args.operationId as string);
        await setStatus(p, "QUEUED", ["HALTED"]);
        return p;
      }
      case "ProposalRegistry.ProposalCommitted":
        return this.linkCommit(d, log);
      default:
        return null;
    }
  }

  /**
   * ProposalCreated -> our Proposal: by the slug in the description, else by matching the encoded calldata of a
   * proposal's latest version. The id is verified with governor.hashProposal(targets, values, calldatas,
   * keccak256(description)), and the timelock operation id is stored for CallScheduled/Flagged matching.
   */
  private async linkProposal(d: LogDescription, _log: Log): Promise<{ id: string; slug: string } | null> {
    const db = this.opts.db;
    // getValue: "values" would hit Result.values(), the array method
    const description = d.args.getValue("description") as string;
    const targets = (d.args.getValue("targets") as string[]).map(String);
    const values = [...(d.args.getValue("values") as bigint[])];
    const calldatas = (d.args.getValue("calldatas") as string[]).map(String);

    let match: { id: string; slug: string } | null = null;
    const slug = /\b([A-Z]+-\d+)\b/.exec(description)?.[1];
    if (slug) match = await db.proposal.findUnique({ where: { slug }, select: { id: true, slug: true } });
    if (!match) {
      const candidates = await db.proposal.findMany({ where: { governorProposalId: null }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
      for (const c of candidates) {
        const actions = (c.versions[0]?.canonicalJson as { onchainActions?: unknown } | undefined)?.onchainActions;
        try {
          const enc = encodeActions(actions, this.opts.deployments, c.slug);
          if (JSON.stringify(enc.calldatas.map(lower)) === JSON.stringify(calldatas.map(lower)) && JSON.stringify(enc.targets.map(lower)) === JSON.stringify(targets.map(lower))) {
            match = { id: c.id, slug: c.slug };
            break;
          }
        } catch {
          // no encodable actions on this proposal: cannot match by calldata
        }
      }
    }
    if (!match) return null;

    const governor = this.contract("MeridianGovernor");
    const timelock = this.contract("GuardedTimelock");
    const descriptionHash = keccak256(toUtf8Bytes(description));
    const proposalId = (await governor.getFunction("hashProposal")(targets, values, calldatas, descriptionHash)) as bigint;
    if (proposalId !== (d.args.proposalId as bigint)) {
      this.opts.logger.warn({ slug: match.slug, event: String(d.args.proposalId), computed: String(proposalId) }, "hashProposal mismatch; not linking");
      return null;
    }
    // GovernorTimelockControl: salt = bytes20(governor) ^ descriptionHash
    const salt = toBeHex((BigInt(governor.target as string) << 96n) ^ BigInt(descriptionHash), 32);
    const operationId = (await timelock.getFunction("hashOperationBatch")(targets, values, calldatas, ZeroHash, salt)) as string;
    await db.proposal.update({ where: { id: match.id }, data: { governorProposalId: proposalId.toString(), operationId: lower(operationId), status: "ACTIVE" } });
    return match;
  }

  /** ProposalCommitted(registryId = slug number) -> our Proposal; also records a commit tx the DB missed. */
  private async linkCommit(d: LogDescription, log: Log): Promise<{ id: string; slug: string } | null> {
    const db = this.opts.db;
    const registryId = (d.args.proposalId as bigint).toString();
    const candidates = await db.proposal.findMany({ where: { slug: { endsWith: `-${registryId}` } }, select: { id: true, slug: true, status: true } });
    const p = candidates.find((c) => c.slug.split("-").pop() === registryId) ?? null;
    if (!p) return null;
    await db.proposalVersion.updateMany({ where: { proposalId: p.id, versionHash: lower(d.args.versionHash as string), commitTxHash: null }, data: { commitTxHash: log.transactionHash } });
    if (p.status === "DRAFT" || p.status === "INGESTED") await db.proposal.update({ where: { id: p.id }, data: { status: "COMMITTED" } });
    return { id: p.id, slug: p.slug };
  }

  private contract(name: string): Contract {
    const entry = this.opts.deployments.contracts[name];
    if (!entry) throw new Error(`${name} missing from deployments`);
    return new Contract(entry.address, entry.abi as never, this.opts.provider);
  }
}
