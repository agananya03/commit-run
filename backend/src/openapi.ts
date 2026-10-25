import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ApiError, CoiReport, CommitResult, CreateProposalRequest, DisclosureRequest, Health, ReverifyResult, Proposal, ProposalBundle, ProposalVersion, RunResult } from "./contracts/schemas.js";

const errors = (...codes: (400 | 404 | 409 | 502)[]) =>
  Object.fromEntries(
    codes.map((c) => [c, { description: { 400: "Validation failed", 404: "Not found", 409: "Conflict", 502: "Upstream error" }[c], content: { "application/json": { schema: ApiError } } }]),
  );

const file = z.string().meta({ type: "string", format: "binary" });
const evidenceFields = {
  forum: file.optional(),
  pdf: file.optional(),
  social: file.optional(),
  onchain: file.optional(),
  disclosure: file.optional(),
};
const idParam = z.object({ id: z.string().meta({ description: "Slug (MIP-21) or database id", example: "MIP-21" }) });

/** OpenAPI 3.1 document generated from the same zod schemas that validate requests and upstream responses. */
export function buildOpenApiDocument() {
  const r = new OpenAPIRegistry();

  r.registerPath({
    method: "get",
    path: "/health",
    summary: "Service and dependency status",
    responses: { 200: { description: "Health", content: { "application/json": { schema: Health } } } },
  });

  r.registerPath({
    method: "get",
    path: "/proposals",
    summary: "List proposals",
    responses: { 200: { description: "Proposals by slug", content: { "application/json": { schema: z.array(Proposal) } } } },
  });

  r.registerPath({
    method: "post",
    path: "/proposals",
    summary: "Register a proposal and seal version 1",
    description:
      "JSON `{ slug }` loads `data/scenarios/<slug>/`. Multipart uploads files instead: fields `slug`, `title`, `proposer` plus one file per evidence type (`forum`, `pdf`, `social`, `onchain`, `disclosure`).",
    request: {
      body: {
        content: {
          "application/json": { schema: CreateProposalRequest },
          "multipart/form-data": { schema: z.object({ slug: z.string(), title: z.string(), proposer: z.string(), ...evidenceFields }) },
        },
      },
    },
    responses: { 201: { description: "Created", content: { "application/json": { schema: ProposalBundle } } }, ...errors(400, 404, 409) },
  });

  r.registerPath({
    method: "get",
    path: "/proposals/{id}",
    summary: "Full bundle: versions, files, summary, intent, simulation, coi, findings, risk, chain events",
    request: { params: idParam },
    responses: { 200: { description: "Bundle", content: { "application/json": { schema: ProposalBundle } } }, ...errors(404) },
  });

  r.registerPath({
    method: "post",
    path: "/proposals/{id}/run",
    summary: "Run the analysis pipeline for the latest version",
    description:
      "BullMQ: ingest, then summarize + extractIntent in parallel, then commit, coi, simulate, verdict, risk. Each step retries twice with backoff, " +
      "is idempotent per (version, step), and emits pipeline:progress. 409 if this version already ran; add ?force=true to re-run. Inspect jobs at /queues.",
    request: { params: idParam, query: z.object({ force: z.enum(["true", "false"]).optional() }) },
    responses: { 202: { description: "Queued", content: { "application/json": { schema: RunResult } } }, ...errors(404, 409, 502) },
  });

  r.registerPath({
    method: "post",
    path: "/proposals/{id}/commit",
    summary: "Commit uncommitted versions to ProposalRegistry",
    description:
      "Calls ProposalRegistry.commit(registryId, versionHash, prevHash, evidenceRoot, uri) for every uncommitted version, oldest first, and stores each commitTxHash. " +
      "registryId is the slug's number (MIP-21 -> 21); uri is poi://<slug>/v<n>. Returns the last commit. 409 CHAIN_REVERT on a stale prevHash or a chain owned by another committer; 409 CONFLICT if nothing is pending.",
    request: { params: idParam },
    responses: { 200: { description: "Committed", content: { "application/json": { schema: CommitResult } } }, ...errors(404, 409, 502) },
  });

  r.registerPath({
    method: "post",
    path: "/proposals/{id}/versions",
    summary: "Seal a new version (recomputes the hash chain)",
    description:
      "Multipart: each uploaded file replaces the file of the same type; the rest carry over. No body: re-reads `data/scenarios/<slug>/`. 409 if nothing changed.",
    request: { params: idParam, body: { required: false, content: { "multipart/form-data": { schema: z.object(evidenceFields) } } } },
    responses: { 201: { description: "New version", content: { "application/json": { schema: ProposalVersion } } }, ...errors(400, 404, 409) },
  });

  r.registerPath({
    method: "post",
    path: "/proposals/{id}/disclosure",
    summary: "Submit a signed wallet disclosure (seals a new version)",
    description:
      "signature = EIP-191 personal_sign by the proposer over the RFC 8785 canonical JSON of { proposalSlug, wallets, statement } with wallets lowercased, de-duplicated and sorted. " +
      "Verified with ethers.verifyMessage; stored as the `disclosure` evidence file (enters the evidence Merkle root) of a new version. Returns the COI report scored with it: " +
      "linked wallets missing from the signed list count as undisclosed. 400 if the signer is not the proposer; 409 if the same disclosure is already in the latest version.",
    request: { params: idParam, body: { required: true, content: { "application/json": { schema: DisclosureRequest } } } },
    responses: { 201: { description: "COI report for the new version", content: { "application/json": { schema: CoiReport } } }, ...errors(400, 404, 409) },
  });

  r.registerPath({
    method: "post",
    path: "/proposals/{id}/reverify",
    summary: "Recompute everything and compare with the chain (who watches the watchdog)",
    description:
      "Per version: re-hashes the stored evidence files, rebuilds canonical JSON, evidence root and versionHash from scratch (chaining recomputed prevHashes) and compares them with ProposalRegistry's ProposalCommitted logs. " +
      "Then replays the decisive simulation (the flagged run, else the latest queued, else the latest proposed) on its pinned fork block and compares simHash, and recomputes the findings and compares their hash with the findingsHash in GovernanceGuard's Flagged event.",
    request: { params: idParam },
    responses: { 200: { description: "Comparison", content: { "application/json": { schema: ReverifyResult } } }, ...errors(404, 409, 502) },
  });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ProofOfIntent backend",
      version: "0.1.0",
      description: "Governance watchdog API. Live events on Socket.IO (same origin): pipeline:progress, chain:event, watchdog:flag.",
    },
    servers: [{ url: "http://localhost:4000" }],
  });
}
