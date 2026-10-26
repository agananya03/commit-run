// The watchdog: when a proposal is queued in the GuardedTimelock, re-simulate exactly the queued payloads, recompute
// findings and risk, and if the verdict is "halt", flag the operation on GovernanceGuard before the delay runs out.
import { Contract, getAddress, id as topicOf, Interface, type JsonRpcProvider, type Signer } from "ethers";
import type { Logger } from "pino";
import type { WatchdogFlag } from "../../../shared/schemas/types.js";
import type { DeploymentsT } from "../chain/contracts.js";
import type { RegistryClient } from "../chain/registry.js";
import type { FactCheckClient } from "../clients/factCheckClient.js";
import type { RagClient } from "../clients/ragClient.js";
import type { SimClient } from "../clients/simClient.js";
import type { Db } from "../db.js";
import type { EventBus } from "../events.js";
import type { Prisma } from "../generated/prisma/client.js";
import { riskForRun, saveRisk } from "../risk/service.js";
import { attestRun } from "../verdict/assessment.js";
import { explainFindings } from "../verdict/explain.js";
import { compactFindings, findingsForRun, findingsHash, storeFindings } from "../verdict/service.js";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const CALL_SCHEDULED = topicOf("CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)");

export interface WatchdogOptions {
  db: Db;
  sim: SimClient;
  rag: RagClient;
  /** NLI fact-check for the claims stage (usually cached from the pipeline run). */
  factCheck?: FactCheckClient;
  /** Attests the technical assessment of the exact queued payload (after the flag decision). */
  registry?: RegistryClient;
  provider: JsonRpcProvider;
  /** Holds WATCHDOG_ROLE on GovernanceGuard (WATCHDOG_PRIVATE_KEY). */
  signer: Signer;
  deployments: DeploymentsT;
  bus?: EventBus;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export type WatchdogOutcome =
  | { operationId: string; outcome: "skipped"; reason: string }
  | { operationId: string; outcome: "cleared" | "flagged"; proposalId: string; level: string; action: string; ms: Record<string, number>; txHash?: string };

/** One queued operation, read back from its CallScheduled logs (one log per call of the batch). */
export interface QueuedOperation {
  operationId: string;
  blockNumber: number;
  delay: number;
  targets: string[];
  values: string[];
  calldatas: string[];
}

/** Reads a queued batch from its CallScheduled logs: the payloads that will actually execute, not the forum version. */
export async function readQueuedOperation(provider: JsonRpcProvider, timelock: Contract, operationId: string): Promise<QueuedOperation | null> {
  const logs = await provider.getLogs({ address: timelock.target as string, topics: [CALL_SCHEDULED, operationId], fromBlock: 0, toBlock: "latest" });
  if (logs.length === 0) return null;
  const iface = timelock.interface as Interface;
  const calls = logs.map((l) => iface.parseLog(l)!).sort((a, b) => Number(a.args.index) - Number(b.args.index));
  return {
    operationId,
    blockNumber: Math.max(...logs.map((l) => l.blockNumber)),
    delay: Number(calls[0]!.args.delay),
    targets: calls.map((c) => getAddress(c.args.target as string)),
    values: calls.map((c) => (c.args.value as bigint).toString()),
    calldatas: calls.map((c) => c.args.data as string),
  };
}

export class Watchdog {
  private readonly timelock: Contract;
  private readonly guard: Contract;
  private readonly inFlight = new Map<string, Promise<WatchdogOutcome>>();

  constructor(private readonly o: WatchdogOptions) {
    const c = (name: string) => {
      const entry = o.deployments.contracts[name];
      if (!entry) throw new Error(`${name} missing from deployments`);
      return entry;
    };
    this.timelock = new Contract(c("GuardedTimelock").address, c("GuardedTimelock").abi as never, o.provider);
    this.guard = new Contract(c("GovernanceGuard").address, c("GovernanceGuard").abi as never, o.signer);
  }

  /** Called by the chain listener for every CallScheduled; one check per operation however many calls it batches. */
  onCallScheduled(operationId: string): void {
    const op = operationId.toLowerCase();
    if (this.inFlight.has(op)) return;
    const run = this.check(op)
      .catch((err: Error): WatchdogOutcome => {
        this.o.logger.error({ operationId: op, err: err.message }, "watchdog check failed");
        return { operationId: op, outcome: "skipped", reason: err.message };
      })
      .finally(() => setTimeout(() => this.inFlight.delete(op), 60_000)); // replays of the same logs within a minute are ignored
    this.inFlight.set(op, run);
  }

  /** For tests and scripts: the result of the check started for this operation, if any. */
  result(operationId: string): Promise<WatchdogOutcome> | undefined {
    return this.inFlight.get(operationId.toLowerCase());
  }

  queued(operationId: string): Promise<QueuedOperation | null> {
    return readQueuedOperation(this.o.provider, this.timelock, operationId);
  }

  async check(operationId: string): Promise<WatchdogOutcome> {
    const { db, logger } = this.o;
    const ms: Record<string, number> = {};
    const t0 = Date.now();
    const lap = (name: string, since: number) => (ms[name] = Date.now() - since);

    if (!((await this.timelock.getFunction("isOperationPending")(operationId)) as boolean)) return { operationId, outcome: "skipped", reason: "operation is not pending (executed or cancelled)" };
    if ((await this.guard.getFunction("isFlagged")(operationId)) as boolean) return { operationId, outcome: "skipped", reason: "already flagged" };
    const op = await this.queued(operationId);
    if (!op) return { operationId, outcome: "skipped", reason: "no CallScheduled logs for this operation" };
    const proposal = await db.proposal.findFirst({ where: { operationId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const version = proposal?.versions[0];
    if (!proposal || !version) return { operationId, outcome: "skipped", reason: "operation is not one of our proposals (no ProposalCreated link)" };
    lap("load", t0);
    logger.info({ proposal: proposal.slug, operationId, calls: op.targets.length, delaySec: op.delay }, "watchdog: proposal queued, re-simulating the queued payloads");

    // 1. Exactly the queued payloads, on the state right after they were queued (pinned, so reverify can replay it).
    let t = Date.now();
    const result = await this.o.sim.simulate({ proposalId: proposal.slug, targets: op.targets, values: op.values, calldatas: op.calldatas, forkBlock: op.blockNumber });
    const run = await db.simulationRun.create({
      data: { proposalId: proposal.id, proposalVersionId: version.id, source: "QUEUED", operationId, forkBlock: op.blockNumber, data: json(result), success: result.success, simHash: result.simHash, bytecodeHash: result.bytecodeHash },
    });
    lap("simulate", t);

    // 2. Findings against what the text promised, then 3. the risk chain over them.
    t = Date.now();
    const findings = await findingsForRun(db, run.id, version.id);
    await storeFindings(db, run, findings);
    lap("findings", t);
    t = Date.now();
    // the timelock delay is running: the fact-check gets at most 3 s, then the claims stage uses the RAG labels
    const factCheck = this.o.factCheck ? await Promise.race([this.o.factCheck.summary(proposal.slug), new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))]) : null;
    const risk = await riskForRun(db, run.id, { factCheck });
    await saveRisk(db, run, risk);
    lap("risk", t);

    let txHash: string | undefined;
    if (risk.action === "halt") {
      t = Date.now();
      const hash = findingsHash(findings);
      const tx = await this.guard.getFunction("flag")(operationId, hash);
      const receipt = await tx.wait();
      lap("flag", t);
      txHash = tx.hash as string;
      const flag: WatchdogFlag = { proposalId: proposal.slug, operationId, findingsHash: hash, findings: compactFindings(findings), risk, txHash: txHash!, blockNumber: receipt.blockNumber as number, flaggedAt: new Date().toISOString() };
      await db.$transaction([
        db.watchdogFlagRecord.create({ data: { proposalId: proposal.id, simulationRunId: run.id, operationId, findingsHash: hash, txHash: txHash!, blockNumber: flag.blockNumber, data: json(flag) } }),
        db.proposal.update({ where: { id: proposal.id }, data: { status: "HALTED" } }),
      ]);
      this.o.bus?.emit("watchdog:flag", flag);
    }
    ms.total = Date.now() - t0;
    const budget = op.delay * 1000;
    const log = { proposal: proposal.slug, operationId, level: risk.level, action: risk.action, posterior: risk.posterior, findings: findings.length, txHash, ms, delayMs: budget };
    if (ms.total > budget) logger.error(log, "watchdog: finished AFTER the timelock delay; the operation may already be executable");
    else if (ms.total > budget / 2) logger.warn(log, "watchdog: used more than half of the timelock delay");
    else logger.info(log, risk.action === "halt" ? "watchdog: operation FLAGGED on GovernanceGuard" : "watchdog: queued payloads cleared");

    // The plain-English explanation can take an LLM round trip: never let it delay the flag.
    void explainFindings(this.o.rag, proposal.slug, findings)
      .then(({ explanation }) => db.simulationRun.update({ where: { id: run.id }, data: { explanation: json(explanation) } }))
      .catch((err: Error) => logger.warn({ err: err.message, proposal: proposal.slug }, "watchdog: explanation failed (flag unaffected)"));
    // Likewise the technical assessment of the exact queued payload: on the record, after the decision.
    if (this.o.registry)
      void attestRun(db, this.o.registry, run.id, findings)
        .then(({ reportHash }) => logger.info({ proposal: proposal.slug, reportHash }, "watchdog: queued-payload assessment attested in ProposalRegistry"))
        .catch((err: Error) => logger.warn({ err: err.message, proposal: proposal.slug }, "watchdog: assessment attestation failed (flag unaffected)"));

    return { operationId, outcome: risk.action === "halt" ? "flagged" : "cleared", proposalId: proposal.slug, level: risk.level, action: risk.action, ms, ...(txHash ? { txHash } : {}) };
  }
}
