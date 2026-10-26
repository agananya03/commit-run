import { z } from "zod";
import type { FactCheckSummary } from "../risk/chain.js";
import { Upstream, type UpstreamOptions } from "./upstream.js";

/**
 * The NLI fact-check board served by the frontend (POST /api/factcheck, local DeBERTa-v3): every claim from the
 * proposal's documents, ruled against the simulated code. Only the fields the risk chain reads are required.
 */
export const FactCheckBoard = z.object({
  proposalId: z.string(),
  model: z.string().nullable(),
  ms: z.number(),
  witnesses: z.array(
    z.object({
      id: z.enum(["code", "pdf", "forum", "social", "disclosure"]),
      label: z.string(),
      statements: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
  rulings: z.record(z.string(), z.object({ verdict: z.enum(["contradicted", "supported", "unclear"]), score: z.number(), evidence: z.string().optional(), exact: z.boolean().optional() })),
});

export type FactCheckBoardT = z.infer<typeof FactCheckBoard>;

/** Board -> the counts and top catches the claims stage needs; null when the model didn't run. */
export function summarizeBoard(board: FactCheckBoardT): FactCheckSummary | null {
  if (!board.model) return null;
  const text = new Map(board.witnesses.flatMap((w) => w.statements.map((s) => [s.id, s.text] as const)));
  const docs = board.witnesses.filter((w) => w.id !== "code").flatMap((w) => w.statements.map((s) => ({ ...s, witness: w.label })));
  const ruled = docs.map((s) => ({ s, r: board.rulings[s.id] })).filter((x) => x.r);
  const caught = ruled
    .filter((x) => x.r!.verdict === "contradicted")
    .sort((a, b) => b.r!.score - a.r!.score)
    .map((x) => ({ claim: x.s.text, witness: x.s.witness, evidence: text.get(x.r!.evidence ?? "") ?? "" }));
  return {
    model: board.model,
    statements: docs.length,
    contradicted: caught.length,
    confirmed: ruled.filter((x) => x.r!.verdict === "supported").length,
    caught: caught.slice(0, 3),
  };
}

const TTL_MS = 10 * 60_000;

/** Typed client for the fact-check service. Mocks: factcheck.<proposalId>.json (a board snapshot). */
export class FactCheckClient {
  private readonly upstream: Upstream;
  // the pipeline's risk step fetches it first; the watchdog, racing a timelock, reuses that answer
  private readonly cache = new Map<string, { at: number; summary: FactCheckSummary | null }>();

  constructor(opts: Omit<UpstreamOptions, "service">) {
    this.upstream = new Upstream({ ...opts, service: "factcheck" });
  }

  board(proposalId: string) {
    return this.upstream.call({ method: "post", path: "/api/factcheck", body: { proposalId }, schema: FactCheckBoard, mock: `factcheck.${proposalId}.json` });
  }

  /** The claims-stage summary, or null when the fact-check is unavailable (the stage then uses the RAG labels). */
  async summary(proposalId: string): Promise<FactCheckSummary | null> {
    const hit = this.cache.get(proposalId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.summary;
    const summary = await this.board(proposalId).then(summarizeBoard, () => null);
    if (summary) this.cache.set(proposalId, { at: Date.now(), summary }); // a miss is retried next time
    return summary;
  }
}
