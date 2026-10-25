import { z } from "zod";
import type { ExplainRequest, ExtractIntentRequest, IngestRequest, SearchRequest, SummarizeRequest } from "../../../shared/schemas/types.js";
import { Chunk, DecisionSummary, Explanation, IntentSpec } from "../contracts/schemas.js";
import { Upstream, type UpstreamOptions } from "./upstream.js";

const Chunks = z.array(Chunk);
type ChunkT = z.infer<typeof Chunk>;

/** Typed client for the rag service (B). Mocks: <endpoint>.<proposalId>.json in /shared/mocks. */
export class RagClient {
  private readonly upstream: Upstream;

  constructor(opts: Omit<UpstreamOptions, "service">) {
    this.upstream = new Upstream({ ...opts, service: "rag" });
  }

  ingest(req: IngestRequest) {
    return this.upstream.call({ method: "post", path: "/ingest", body: req, schema: Chunks, mock: `ingest.${req.proposalId}.json` });
  }

  summarize(req: SummarizeRequest) {
    return this.upstream.call({ method: "post", path: "/summarize", body: req, schema: DecisionSummary, mock: `summarize.${req.proposalId}.json` });
  }

  extractIntent(req: ExtractIntentRequest) {
    return this.upstream.call({ method: "post", path: "/extract-intent", body: req, schema: IntentSpec, mock: `extract-intent.${req.proposalId}.json` });
  }

  /** Mock: keyword match over the ingest mock's chunks (real rag does hybrid vector + BM25). */
  search(req: SearchRequest) {
    const terms = req.query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    return this.upstream.call({
      method: "post",
      path: "/search",
      body: req,
      schema: Chunks,
      mock: `ingest.${req.proposalId}.json`,
      fromMock: (data) =>
        (data as ChunkT[])
          .map((c) => ({ c, score: terms.filter((t) => c.text.toLowerCase().includes(t)).length }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, req.k ?? 8)
          .map((x) => x.c),
    });
  }

  explain(req: ExplainRequest) {
    return this.upstream.call({ method: "post", path: "/explain", body: req, schema: Explanation, mock: `explain.${req.proposalId}.json` });
  }

  /** Chunk ids are "<proposalId>:<type>:<n>", so the mock is found from the id. */
  getChunk(id: string) {
    const proposalId = id.split(":")[0] ?? "";
    return this.upstream.call({
      method: "get",
      path: `/chunks/${encodeURIComponent(id)}`,
      schema: Chunk,
      mock: `ingest.${proposalId}.json`,
      fromMock: (data) => (data as ChunkT[]).find((c) => c.id === id),
    });
  }

  ping() {
    return this.upstream.ping();
  }
}
