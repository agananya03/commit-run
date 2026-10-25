/**
 * Zod mirror of /shared/schemas/types.ts. Used to validate every rag/sim response and to generate the
 * OpenAPI document. Objects are strict (unknown keys fail), matching additionalProperties: false in
 * /shared/schemas/json. test/contracts.test.ts fails if any schema here drifts from those JSON Schemas.
 */
import { z } from "zod";

const named = <T extends z.ZodType>(id: string, schema: T): T => schema.meta({ id });

export const Hex = z.string();

// --- Evidence and RAG -------------------------------------------------------

export const SourceType = z.enum(["forum", "pdf", "social", "onchain"]);

export const Chunk = named("Chunk", z.strictObject({
  id: z.string(),
  proposalId: z.string(),
  sourceType: SourceType,
  sourceUri: z.string(),
  page: z.number().optional(),
  text: z.string(),
  sha256: Hex,
}));

export const Citation = named("Citation", z.strictObject({
  chunkId: z.string(),
  sha256: Hex,
  quote: z.string(),
  sourceUri: z.string(),
}));

const Cited = z.strictObject({ text: z.string(), citations: z.array(Citation) });

export const Claim = named("Claim", z.strictObject({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["financial", "technical", "team", "timeline", "other"]),
  citations: z.array(Citation),
  support: z.enum(["supported", "unsupported", "contradicted"]),
  pSupported: z.number(),
}));

export const DecisionSummary = named("DecisionSummary", z.strictObject({
  proposalId: z.string(),
  tldr: z.string(),
  treasuryImpact: z.strictObject({
    amountUsd: z.number().nullable(),
    pctOfTreasury: z.number().nullable(),
    recipients: z.array(z.string()),
    citations: z.array(Citation),
  }),
  dependencies: z.array(Cited),
  risks: z.array(Cited),
  claims: z.array(Claim),
}));

export const IntentAction = named("IntentAction", z.strictObject({
  kind: z.enum(["transfer", "upgrade", "param_change", "approve", "call"]),
  target: z.string().optional(),
  token: z.string().optional(),
  amount: z.string().optional(),
  recipient: z.string().optional(),
  newImplementation: z.string().optional(),
  functionSignature: z.string().optional(),
  description: z.string(),
  citations: z.array(Citation),
}));

export const IntentSpec = named("IntentSpec", z.strictObject({
  proposalId: z.string(),
  summary: z.string(),
  actions: z.array(IntentAction),
  explicitlyExcluded: z.array(z.string()),
  confidence: z.number(),
}));

export const Explanation = named("Explanation", z.strictObject({
  headline: z.string(),
  paragraph: z.string(),
  perFinding: z.array(z.strictObject({ findingId: z.string(), sentence: z.string() })),
}));

// --- Simulation -------------------------------------------------------------

const SelectorRef = z.strictObject({ selector: Hex, signature: z.string().optional() });

export const SimulationResult = named("SimulationResult", z.strictObject({
  proposalId: z.string(),
  success: z.boolean(),
  revertReason: z.string().optional(),
  decodedCalls: z.array(z.strictObject({
    target: z.string(),
    contractName: z.string().optional(),
    selector: Hex,
    signature: z.string().optional(),
    args: z.array(z.unknown()),
  })),
  tokenTransfers: z.array(z.strictObject({ token: z.string(), from: z.string(), to: z.string(), amount: z.string() })),
  approvals: z.array(z.strictObject({ token: z.string(), owner: z.string(), spender: z.string(), amount: z.string() })),
  ownershipChanges: z.array(z.strictObject({ contract: z.string(), role: z.string(), before: z.string(), after: z.string() })),
  implementationChanges: z.array(z.strictObject({
    proxy: z.string(),
    before: z.string(),
    after: z.string(),
    addedSelectors: z.array(SelectorRef),
    removedSelectors: z.array(SelectorRef),
  })),
  storageDiffs: z.array(z.strictObject({ contract: z.string(), slot: Hex, before: Hex, after: Hex })),
  events: z.array(z.strictObject({ contract: z.string(), name: z.string(), args: z.record(z.string(), z.unknown()) })),
  bytecodeHash: Hex,
  simHash: Hex,
}));

export const Deployments = named("Deployments", z.strictObject({
  chainId: z.number(),
  deployBlock: z.number(),
  contracts: z.record(z.string(), z.strictObject({ address: z.string(), abi: z.array(z.unknown()), decimals: z.number().optional() })),
}));

// --- COI, findings, risk ----------------------------------------------------

export const WalletLink = named("WalletLink", z.strictObject({
  from: z.string(),
  to: z.string(),
  path: z.array(z.string()),
  hops: z.number(),
  pLink: z.number(),
  reasons: z.array(z.string()),
}));

export const CoiReport = named("CoiReport", z.strictObject({
  proposalId: z.string(),
  proposer: z.string(),
  disclosed: z.array(z.string()),
  signatureValid: z.boolean(),
  undisclosedLinks: z.array(WalletLink),
  pCoi: z.number(),
}));

export const Finding = named("Finding", z.strictObject({
  id: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  category: z.enum([
    "recipient_mismatch", "amount_mismatch", "undeclared_action", "ownership_change", "unlimited_approval",
    "new_privileged_function", "coi", "unsupported_claim", "contradiction",
  ]),
  said: z.string(),
  does: z.string(),
  evidence: z.array(Citation),
  simRef: z.string().optional(),
}));

export const RiskStage = named("RiskStage", z.strictObject({
  stage: z.enum(["claims", "coi", "voting", "execution"]),
  probability: z.number(),
  likelihoodRatio: z.number(),
  explanation: z.string(),
  findingIds: z.array(z.string()),
}));

export const RiskChain = named("RiskChain", z.strictObject({
  proposalId: z.string(),
  prior: z.number(),
  stages: z.array(RiskStage),
  posterior: z.number(),
  level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  action: z.enum(["none", "review", "halt"]),
}));

// --- Backend ----------------------------------------------------------------

export const ProposalStatus = named("ProposalStatus", z.enum(["DRAFT", "INGESTED", "COMMITTED", "ACTIVE", "QUEUED", "HALTED", "EXECUTED", "DEFEATED"]));

export const Proposal = named("Proposal", z.strictObject({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  proposer: z.string(),
  status: ProposalStatus,
  governorProposalId: z.string().nullable(),
  operationId: Hex.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}));

export const EvidenceFile = named("EvidenceFile", z.strictObject({
  type: z.enum(["forum", "pdf", "social", "onchain", "disclosure"]),
  uri: z.string(),
  sha256: Hex,
  bytes: z.number(),
  proof: z.array(Hex),
}));

export const ProposalVersion = named("ProposalVersion", z.strictObject({
  proposalId: z.string(),
  version: z.number(),
  canonicalJson: z.unknown(),
  versionHash: Hex,
  prevHash: Hex,
  evidenceRoot: Hex,
  commitTxHash: Hex.nullable(),
  files: z.array(EvidenceFile),
  createdAt: z.string(),
}));

export const ChainEvent = named("ChainEvent", z.strictObject({
  proposalId: z.string().nullable(),
  contract: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  blockNumber: z.number(),
  txHash: Hex,
  logIndex: z.number(),
}));

export const WatchdogFlag = named("WatchdogFlag", z.strictObject({
  proposalId: z.string(),
  operationId: Hex,
  findingsHash: Hex,
  findings: z.array(Finding),
  risk: RiskChain,
  txHash: Hex,
  blockNumber: z.number(),
  flaggedAt: z.string(),
}));

export const ProposalBundle = named("ProposalBundle", z.strictObject({
  proposal: Proposal,
  versions: z.array(ProposalVersion),
  summary: DecisionSummary.nullable(),
  intent: IntentSpec.nullable(),
  simulation: SimulationResult.nullable(),
  coi: CoiReport.nullable(),
  findings: z.array(Finding),
  explanation: Explanation.nullable(),
  risk: RiskChain.nullable(),
  chainEvents: z.array(ChainEvent),
  flag: WatchdogFlag.nullable(),
}));

export const CreateProposalRequest = named("CreateProposalRequest", z.strictObject({ slug: z.string() }));

export const RunResult = named("RunResult", z.strictObject({ proposalId: z.string(), flowId: z.string() }));

export const DisclosureRequest = named("DisclosureRequest", z.strictObject({
  proposer: z.string(),
  wallets: z.array(z.string()),
  statement: z.string(),
  signature: Hex,
}));

export const CommitResult = named("CommitResult", z.strictObject({
  proposalId: z.string(),
  version: z.number(),
  versionHash: Hex,
  txHash: Hex,
  blockNumber: z.number(),
}));

export const ReverifyResult = named("ReverifyResult", z.strictObject({
  allMatch: z.boolean(),
  versions: z.array(z.strictObject({
    version: z.number(),
    versionHash: Hex,
    onchainVersionHash: Hex.nullable(),
    evidenceRootMatch: z.boolean(),
    match: z.boolean(),
  })),
  simMatch: z.boolean(),
  findingsMatch: z.boolean(),
}));

export const PipelineProgress = named("PipelineProgress", z.strictObject({
  proposalId: z.string(),
  step: z.enum(["ingest", "summarize", "extractIntent", "commit", "coi", "simulate", "verdict", "risk"]),
  status: z.enum(["started", "completed", "failed"]),
  ms: z.number().optional(),
  error: z.string().optional(),
}));

export const ApiError = named("ApiError", z.strictObject({
  error: z.strictObject({
    code: z.enum(["VALIDATION_FAILED", "NOT_FOUND", "CONFLICT", "UPSTREAM_UNAVAILABLE", "UPSTREAM_INVALID", "CHAIN_REVERT", "INTERNAL"]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
}));

export const Health = named("Health", z.strictObject({
  service: z.enum(["backend", "rag", "sim"]),
  status: z.enum(["ok", "degraded"]),
  mocks: z.boolean(),
  deps: z.record(z.string(), z.enum(["ok", "down"])),
}));

/** Schemas checked against /shared/schemas/json by test/contracts.test.ts (name = shared type name). */
export const SHARED_SCHEMAS = {
  Chunk, Citation, Claim, DecisionSummary, IntentAction, IntentSpec, Explanation, SimulationResult, Deployments,
  WalletLink, CoiReport, Finding, RiskStage, RiskChain, ProposalStatus, Proposal, EvidenceFile, ProposalVersion,
  ChainEvent, WatchdogFlag, ProposalBundle, CreateProposalRequest, CommitResult, RunResult, DisclosureRequest, ReverifyResult, PipelineProgress, ApiError, Health,
} as const;
