import { FlowProducer, Queue, Worker, type FlowJob, type Job, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "pino";
import type { PipelineStep } from "../../../shared/schemas/types.js";
import type { Db } from "../db.js";
import { conflict, notFound } from "../errors.js";
import type { EventBus } from "../events.js";
import { STEPS, type StepDeps, type StepJobData, type StepResult } from "./steps.js";

export const QUEUE = "pipeline";

/** 2 retries with exponential backoff; a child that finally fails fails its parent (no pipeline stuck "waiting"). */
const JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  failParentOnFailure: true,
  removeOnComplete: false,
  removeOnFail: false,
};

export interface PipelineOptions {
  redisUrl: string;
  /** Redis key prefix; tests use their own so they never touch the real queue. */
  prefix?: string;
  db: Db;
  deps: StepDeps;
  bus?: EventBus;
  logger: Pick<Logger, "info" | "warn" | "error">;
  concurrency?: number;
}

/** BullMQ forbids ":" in custom ids. */
export const jobId = (versionId: string, step: PipelineStep): string => `${versionId}-${step}`;

/**
 * ingest runs alone; once it completes, the rest is added as one BullMQ flow (children run before parents):
 *
 *   risk <- verdict <- simulate <- coi <- commit <- { summarize, extractIntent }
 *
 * A flow is a tree, so "summarize and extractIntent both after ingest" is expressed by enqueueing the
 * tree from ingest. Job ids are <proposalVersionId>-<step>, so enqueueing twice never duplicates a job.
 */
function restOfPipeline(data: StepJobData, prefix: string): FlowJob {
  const node = (step: PipelineStep, children?: FlowJob[]): FlowJob => ({
    name: step,
    queueName: QUEUE,
    data,
    prefix,
    opts: { ...JOB_OPTS, jobId: jobId(data.versionId, step) },
    ...(children ? { children } : {}),
  });
  return node("risk", [node("verdict", [node("simulate", [node("coi", [node("commit", [node("summarize"), node("extractIntent")])])])])]);
}

export class Pipeline {
  readonly queue: Queue;
  private readonly flows: FlowProducer;
  private readonly worker: Worker;
  private readonly connections: Redis[] = [];
  private readonly prefix: string;

  constructor(private readonly opts: PipelineOptions) {
    this.prefix = opts.prefix ?? "bull";
    const connection = () => {
      const c = new Redis(opts.redisUrl, { maxRetriesPerRequest: null });
      this.connections.push(c);
      return c;
    };
    this.queue = new Queue(QUEUE, { connection: connection(), prefix: this.prefix });
    this.flows = new FlowProducer({ connection: connection(), prefix: this.prefix });
    this.worker = new Worker(QUEUE, (job: Job<StepJobData>) => this.process(job), {
      connection: connection(),
      prefix: this.prefix,
      concurrency: opts.concurrency ?? 4,
    });
    this.worker.on("active", (job: Job<StepJobData>) => this.progress(job, "started"));
    this.worker.on("completed", (job: Job<StepJobData>) => {
      this.progress(job, "completed");
      // Enqueue the rest only once ingest is marked complete, so progress events arrive in dependency order.
      if (job.name === "ingest") void this.flows.add(restOfPipeline(job.data, this.prefix)).catch((err: Error) => this.opts.logger.error({ err: err.message, proposal: job.data.slug }, "could not enqueue the rest of the pipeline"));
    });
    this.worker.on("failed", (job: Job<StepJobData> | undefined, err: Error) => {
      if (job) this.progress(job, "failed", err.message);
    });
  }

  /** Starts (or, with force, restarts) the pipeline for the proposal's latest version. */
  async run(idOrSlug: string, { force = false } = {}): Promise<{ proposalId: string; flowId: string }> {
    const proposal = await this.opts.db.proposal.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!proposal) throw notFound(`Proposal ${idOrSlug} not found`);
    const version = proposal.versions[0];
    if (!version) throw conflict(`Proposal ${proposal.slug} has no version to run`);

    const existing = await this.queue.getJob(jobId(version.id, "ingest"));
    if (existing) {
      const state = await existing.getState();
      if (!force) {
        throw conflict(`Pipeline for ${proposal.slug} v${version.version} already exists (${state}); POST again with ?force=true to re-run`, { state });
      }
      if (state === "active") throw conflict(`Pipeline for ${proposal.slug} v${version.version} is running right now; wait for it to finish`);
      await this.removeRun(version.id);
    }

    const data: StepJobData = { proposalId: proposal.id, slug: proposal.slug, versionId: version.id };
    await this.flows.add({ name: "ingest", queueName: QUEUE, data, prefix: this.prefix, opts: { ...JOB_OPTS, jobId: jobId(version.id, "ingest") } });
    return { proposalId: proposal.id, flowId: `pipeline:${version.id}` };
  }

  /** Waits until the run's last step (risk) or any step finishes; for tests and scripts. */
  async waitForRun(versionId: string, timeoutMs = 30_000): Promise<"completed" | "failed"> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ingest = await this.queue.getJob(jobId(versionId, "ingest"));
      if (ingest && (await ingest.getState()) === "failed") return "failed";
      const risk = await this.queue.getJob(jobId(versionId, "risk"));
      const state = risk ? await risk.getState() : null;
      if (state === "completed" || state === "failed") return state;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`pipeline ${versionId} did not finish within ${timeoutMs} ms`);
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.flows.close();
    await this.queue.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  private async process(job: Job<StepJobData>): Promise<StepResult> {
    const step = job.name as PipelineStep;
    const processor = STEPS[step];
    if (!processor) throw new Error(`unknown pipeline step ${job.name}`);
    return processor(job.data, this.opts.deps);
  }

  private async removeRun(versionId: string): Promise<void> {
    for (const step of ["risk", "ingest"] as const) {
      const job = await this.queue.getJob(jobId(versionId, step));
      await job?.remove({ removeChildren: true });
    }
  }

  private progress(job: Job<StepJobData>, status: "started" | "completed" | "failed", error?: string): void {
    const ms = status !== "started" && job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : undefined;
    const step = job.name as PipelineStep;
    this.opts.bus?.emit("pipeline:progress", {
      proposalId: job.data.slug,
      step,
      status,
      ...(ms !== undefined ? { ms } : {}),
      ...(error ? { error } : {}),
    });
    const log = { proposal: job.data.slug, step, status, ms, attempt: job.attemptsMade };
    if (status === "failed") this.opts.logger.warn({ ...log, error }, "pipeline step failed");
    else this.opts.logger.info(log, "pipeline step");
  }
}
