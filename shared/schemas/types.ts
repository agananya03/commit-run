/**
 * ProofOfIntent shared contract: the single source of truth for every
 * payload that crosses a service boundary (rag :8000, sim :4002,
 * backend :4000, frontend :3000).
 *
 * STATUS: draft v0. Do not rename, remove or retype a field without telling
 * the team first. JSON Schemas in ./json are generated from this file
 * (`npm run gen:schemas`), so never hand-edit them.
 *
 * Wire conventions:
 * - camelCase field names.
 * - uint256 values (wei, token amounts, vote weights) are decimal strings.
 * - Timestamps are ISO 8601 UTC strings.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Meridian Improvement Proposal id.
 * @pattern ^MIP-[0-9]+$
 */
export type ProposalId = string;

/**
 * 20-byte EVM address, 0x-prefixed (checksum optional).
 * @pattern ^0x[0-9a-fA-F]{40}$
 */
export type Address = string;

/**
 * 32-byte hash, 0x-prefixed (keccak256 unless stated otherwise).
 * @pattern ^0x[0-9a-fA-F]{64}$
 */
export type Hash32 = string;

/**
 * 4-byte function selector, 0x-prefixed.
 * @pattern ^0x[0-9a-fA-F]{8}$
 */
export type Selector = string;

/**
 * Arbitrary-length hex bytes, 0x-prefixed.
 * @pattern ^0x([0-9a-fA-F]{2})*$
 */
export type HexData = string;

/**
 * uint256 as a base-10 string.
 * @pattern ^[0-9]+$
 */
export type Uint256 = string;

/**
 * ISO 8601 UTC timestamp.
 * @format date-time
 */
export type IsoDateTime = string;

/**
 * Probability in [0, 1].
 * @minimum 0
 * @maximum 1
 */
export type Probability = number;

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type RiskLevel = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export interface Citation {
  /** SourceDocument.id the quote comes from. */
  documentId: string;
  chunkId?: string;
  /** Verbatim excerpt supporting the statement. */
  quote: string;
  /** 1-based page number for PDFs. */
  page?: number;
}

/** A single call inside a Timelock batch operation. */
export interface TimelockCall {
  target: Address;
  /** ETH sent with the call, in wei. */
  value: Uint256;
  data: HexData;
}

/** The proposal as submitted on chain (Governor + Timelock view). */
export interface OnchainProposal {
  /** Governor proposalId (uint256). */
  governorProposalId: Uint256;
  proposer: Address;
  governor: Address;
  timelock: Address;
  calls: TimelockCall[];
  /** keccak256 of the proposal description string. */
  descriptionHash: Hash32;
  /** Timelock hashOperationBatch(targets, values, payloads, 0x0, descriptionHash). */
  operationId: Hash32;
}

export interface HealthResponse {
  service: "backend" | "rag" | "sim";
  status: "ok" | "degraded";
  version: string;
  /** True when the service is answering from /shared/mocks. */
  mocks: boolean;
  /** Dependency name -> state, e.g. { "postgres": "ok", "redis": "down" }. */
  deps?: Record<string, "ok" | "down">;
}

/** Body of every 4xx/5xx response, from all three services. */
export interface ApiError {
  error: {
    /** Machine-readable, e.g. "NOT_FOUND", "VALIDATION_FAILED", "UPSTREAM_INVALID". */
    code: string;
    message: string;
    details?: unknown;
  };
}

// ---------------------------------------------------------------------------
// RAG service (:8000)
// ---------------------------------------------------------------------------

export type SourceKind = "forum" | "pdf" | "social" | "calldata";

export interface SourceInput {
  kind: SourceKind;
  /** Path relative to the repo root (e.g. data/MIP-21/forum.json) or a URL. */
  uri: string;
}

export interface SourceDocument {
  /** Stable id, "<proposalId>:<kind>:<n>", e.g. "MIP-21:forum:0". */
  id: string;
  proposalId: ProposalId;
  kind: SourceKind;
  uri: string;
  title?: string;
  /** Handle, ENS name or address of the author. */
  author?: string;
  publishedAt?: IsoDateTime;
  /** keccak256 of the normalised document text; feeds the evidence chain. */
  contentHash: Hash32;
  chunkCount: number;
  /** First few hundred characters, for display. */
  excerpt?: string;
}

/** POST /ingest */
export interface IngestRequest {
  proposalId: ProposalId;
  sources: SourceInput[];
}

export interface IngestResponse {
  proposalId: ProposalId;
  documents: SourceDocument[];
  /** Total chunks embedded into pgvector across all documents. */
  chunkCount: number;
  /** Parsed from the calldata source when one is ingested. */
  onchain?: OnchainProposal;
  /** Non-fatal problems, e.g. an unreadable PDF page. */
  warnings: string[];
  ingestedAt: IsoDateTime;
}

/** POST /summarize */
export interface SummarizeRequest {
  proposalId: ProposalId;
}

export interface SummarizeResponse {
  proposalId: ProposalId;
  title: string;
  summary: string;
  keyPoints: string[];
  citations: Citation[];
  model?: string;
}

export type ClaimCategory =
  | "gas"
  | "ownership"
  | "funds"
  | "permissions"
  | "upgrade"
  | "parameters"
  | "other";

/** Something the proposal text promises about its own effect. */
export interface IntentClaim {
  /** Unique within the response, e.g. "c1". */
  id: string;
  category: ClaimCategory;
  /** Normalised statement, e.g. "No change to ownership". */
  statement: string;
  /** Whether the text says this thing changes or explicitly stays the same. */
  expectation: "change" | "no_change";
  /** What the claim is about, e.g. "MeridianReserve.owner". */
  subject?: string;
  confidence: Probability;
  citations: Citation[];
}

/** A wallet address mentioned in any source; input to the COI graph. */
export interface WalletMention {
  address: Address;
  documentId: string;
  /** Surrounding text, e.g. "moving ops to my new wallet 0x9f2c...". */
  context: string;
}

/** POST /extract-intent */
export interface ExtractIntentRequest {
  proposalId: ProposalId;
}

export interface ExtractIntentResponse {
  proposalId: ProposalId;
  claims: IntentClaim[];
  /** Contract names or addresses the text says it touches. */
  declaredTargets: string[];
  walletMentions: WalletMention[];
  model?: string;
}

// ---------------------------------------------------------------------------
// Sim service (:4002)
// ---------------------------------------------------------------------------

/** POST /simulate */
export interface SimulateRequest {
  proposalId: ProposalId;
  operationId?: Hash32;
  /** Account the calls are executed from (the Timelock). */
  executor: Address;
  calls: TimelockCall[];
  /** Fork from this block; latest when omitted. */
  forkBlock?: number;
}

export interface DecodedArg {
  name: string;
  /** Solidity type, e.g. "address", "uint256", "bytes". */
  type: string;
  /** Stringified value; bytes and arrays stay as hex / JSON text. */
  value: string;
}

export interface DecodedCall {
  /** Position in the batch (inner calls repeat their parent's index). */
  index: number;
  target: Address;
  targetLabel?: string;
  value: Uint256;
  selector: Selector;
  /** e.g. "upgradeToAndCall(address,bytes)"; absent if unknown. */
  signature?: string;
  args: DecodedArg[];
  /** Calls encoded inside this one, e.g. the initializer in upgradeToAndCall. */
  innerCalls?: DecodedCall[];
}

interface ChangeBase {
  /** Contract whose state changed (the token, for approvals). */
  contract: Address;
  contractLabel?: string;
  severity: Severity;
  /** One human-readable line for the UI. */
  description: string;
}

export interface ImplementationChange extends ChangeBase {
  kind: "implementation_changed";
  before: Address;
  after: Address;
  /** keccak256 of the new implementation's runtime bytecode. */
  newCodeHash: Hash32;
  /** Whether the new implementation's source is known/verified. */
  sourceVerified: boolean;
}

export interface SelectorChange extends ChangeBase {
  kind: "selector_added" | "selector_removed";
  selector: Selector;
  signature?: string;
}

export interface OwnershipChange extends ChangeBase {
  kind: "owner_changed";
  before: Address;
  after: Address;
}

export interface RoleChange extends ChangeBase {
  kind: "role_granted" | "role_revoked";
  role: Hash32;
  roleName?: string;
  account: Address;
}

export interface ApprovalChange extends ChangeBase {
  kind: "approval_changed";
  tokenSymbol?: string;
  owner: Address;
  spender: Address;
  before: Uint256;
  after: Uint256;
  /** True when `after` is type(uint256).max. */
  unlimited: boolean;
}

export interface BalanceChange extends ChangeBase {
  kind: "balance_changed";
  /** Absent for native ETH. */
  tokenSymbol?: string;
  account: Address;
  before: Uint256;
  after: Uint256;
}

export interface StorageChange extends ChangeBase {
  kind: "storage_changed";
  slot: Hash32;
  before: Hash32;
  after: Hash32;
}

/** Discriminated on `kind`. */
export type ExecutionChange =
  | ImplementationChange
  | SelectorChange
  | OwnershipChange
  | RoleChange
  | ApprovalChange
  | BalanceChange
  | StorageChange;

/** Gas cost of a function before vs after the proposal executes. */
export interface GasBenchmark {
  contract: Address;
  contractLabel?: string;
  /** e.g. "deposit(uint256)". */
  signature: string;
  before: number;
  after: number;
}

export interface SimulateResponse {
  proposalId: ProposalId;
  operationId?: Hash32;
  forkBlock: number;
  success: boolean;
  revertReason?: string;
  gasUsed: number;
  decodedCalls: DecodedCall[];
  changes: ExecutionChange[];
  gasBenchmarks: GasBenchmark[];
  simulatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Backend domain (:4000)
// ---------------------------------------------------------------------------

/** OpenZeppelin Governor ProposalState, lower-cased. */
export type ProposalState =
  | "pending"
  | "active"
  | "canceled"
  | "defeated"
  | "succeeded"
  | "queued"
  | "expired"
  | "executed";

export type JobStatus = "queued" | "running" | "done" | "failed";

export type AnalysisStep =
  | "ingest"
  | "summarize"
  | "extract_intent"
  | "simulate"
  | "coi"
  | "voting"
  | "score"
  | "commit"
  | "flag";

export interface Proposal {
  id: ProposalId;
  title: string;
  proposer: Address;
  governorProposalId?: Uint256;
  operationId?: Hash32;
  state: ProposalState;
  analysisStatus: JobStatus | "idle";
  /** Final posterior of the risk chain, once scored. */
  riskScore?: Probability;
  riskLevel?: RiskLevel;
  flagged: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// --- Evidence trail --------------------------------------------------------

export type EvidenceKind =
  | "source_document"
  | "summary"
  | "intent"
  | "simulation"
  | "coi"
  | "voting"
  | "risk"
  | "flag";

export interface EvidenceCommit {
  /** EvidenceRegistry contract address. */
  registry: Address;
  txHash: Hash32;
  blockNumber: number;
  committedAt: IsoDateTime;
}

/**
 * One link of the hash chain.
 * entryHash = keccak256(abi.encode(uint256 index, bytes32 prevHash, string kind, bytes32 payloadHash))
 * The genesis entry (index 0) has prevHash = 0x00...00.
 */
export interface EvidenceEntry {
  proposalId: ProposalId;
  index: number;
  kind: EvidenceKind;
  /** Id of the referenced object, e.g. a SourceDocument.id or job id. */
  refId?: string;
  /** keccak256 of the canonical JSON (sorted keys) of the payload. */
  payloadHash: Hash32;
  prevHash: Hash32;
  entryHash: Hash32;
  /** Set when this entry's hash was committed on chain as the chain head. */
  commit?: EvidenceCommit;
  createdAt: IsoDateTime;
}

/** GET /proposals/:id/evidence */
export interface EvidenceTrail {
  proposalId: ProposalId;
  entries: EvidenceEntry[];
  head: Hash32;
  /** Recomputed every hash and matched the latest on-chain commit. */
  verified: boolean;
}

// --- Conflict of interest --------------------------------------------------

export type WalletRole =
  | "proposer"
  | "alt_wallet"
  | "delegate"
  | "voter"
  | "beneficiary"
  | "contract"
  | "unknown";

export type WalletLinkKind =
  | "funded_by"
  | "same_deployer"
  | "social_claim"
  | "ens"
  | "token_flow"
  | "co_signer"
  | "beneficiary_of";

export interface WalletNode {
  address: Address;
  label?: string;
  roles: WalletRole[];
  votingPower?: Uint256;
}

export interface WalletLink {
  from: Address;
  to: Address;
  kind: WalletLinkKind;
  confidence: Probability;
  /** Why we believe the link exists. */
  evidence: string;
  txHash?: Hash32;
  documentId?: string;
}

export interface CoiFinding {
  id: string;
  summary: string;
  addresses: Address[];
  probability: Probability;
  severity: Severity;
}

/** GET /proposals/:id/coi */
export interface CoiGraph {
  proposalId: ProposalId;
  nodes: WalletNode[];
  links: WalletLink[];
  findings: CoiFinding[];
}

// --- Voting ----------------------------------------------------------------

export type VoteSupport = "for" | "against" | "abstain";

export interface Vote {
  voter: Address;
  support: VoteSupport;
  weight: Uint256;
  txHash?: Hash32;
  /** Voter is linked to the proposer in the COI graph. */
  linkedToProposer: boolean;
}

export interface VotingSnapshot {
  proposalId: ProposalId;
  snapshotBlock: number;
  deadlineBlock: number;
  forVotes: Uint256;
  againstVotes: Uint256;
  abstainVotes: Uint256;
  quorum: Uint256;
  totalSupply: Uint256;
  votes: Vote[];
}

// --- Risk chain ------------------------------------------------------------

export type RiskStageName = "claims" | "coi" | "voting" | "execution";

export interface RiskSignal {
  id: string;
  description: string;
  /** Likelihood ratio this signal contributes; >1 raises risk, <1 lowers it. */
  likelihoodRatio: number;
  /** EvidenceEntry.index backing this signal. */
  evidenceIndex?: number;
}

/**
 * One Bayesian update: posterior odds = prior odds * likelihoodRatio,
 * where likelihoodRatio is the product of the signals' ratios.
 * Each stage's prior is the previous stage's posterior.
 */
export interface RiskStage {
  stage: RiskStageName;
  prior: Probability;
  likelihoodRatio: number;
  posterior: Probability;
  signals: RiskSignal[];
}

/** Executed effect that contradicts or was missing from the proposal text. */
export interface Deviation {
  id: string;
  type: "contradicts_claim" | "undisclosed_change";
  /** IntentClaim.id contradicted, when type is "contradicts_claim". */
  claimId?: string;
  change: ExecutionChange;
  severity: Severity;
  explanation: string;
}

/** GET /proposals/:id/risk */
export interface RiskReport {
  proposalId: ProposalId;
  /** Prior P(malicious) before any evidence. */
  baseRate: Probability;
  /** Always in order: claims, coi, voting, execution. */
  stages: RiskStage[];
  posterior: Probability;
  level: RiskLevel;
  deviations: Deviation[];
  recommendation: "pass" | "review" | "flag";
  computedAt: IsoDateTime;
}

// --- Flagging --------------------------------------------------------------

/** POST /proposals/:id/flag */
export interface FlagRequest {
  reason: string;
}

/** Result of GovernanceGuard.flag(operationId, reasonHash). */
export interface FlagEvent {
  proposalId: ProposalId;
  operationId: Hash32;
  reason: string;
  /** keccak256 of `reason`, as passed on chain. */
  reasonHash: Hash32;
  guard: Address;
  txHash: Hash32;
  blockNumber: number;
  flaggedBy: Address;
  /** True when raised by the pipeline, false for POST /flag. */
  auto: boolean;
  flaggedAt: IsoDateTime;
}

// --- Backend API responses -------------------------------------------------

/** GET /proposals */
export interface ProposalListResponse {
  proposals: Proposal[];
}

/** GET /proposals/:id: everything the dashboard needs in one call. */
export interface ProposalDetail {
  proposal: Proposal;
  onchain?: OnchainProposal;
  documents: SourceDocument[];
  summary?: SummarizeResponse;
  intent?: ExtractIntentResponse;
  simulation?: SimulateResponse;
  coi?: CoiGraph;
  voting?: VotingSnapshot;
  risk?: RiskReport;
  evidence: EvidenceTrail;
  flag?: FlagEvent;
}

/** POST /proposals/:id/analyze */
export interface AnalyzeRequest {
  /** Defaults to every source found under data/<proposalId>/. */
  sources?: SourceInput[];
  /** Raise GovernanceGuard.flag() automatically on deviation (default true). */
  autoFlag?: boolean;
}

export interface AnalyzeResponse {
  jobId: string;
  proposalId: ProposalId;
  status: "queued";
}

/** GET /jobs/:jobId */
export interface AnalysisJob {
  jobId: string;
  proposalId: ProposalId;
  status: JobStatus;
  step?: AnalysisStep;
  /** 0 to 100. */
  progress: number;
  error?: string;
  queuedAt: IsoDateTime;
  startedAt?: IsoDateTime;
  finishedAt?: IsoDateTime;
}

// --- Socket.IO (backend -> frontend) ---------------------------------------

export interface AnalysisProgressEvent {
  jobId: string;
  proposalId: ProposalId;
  step: AnalysisStep;
  status: "started" | "completed" | "failed";
  /** 0 to 100, for the whole job. */
  progress: number;
  message?: string;
  at: IsoDateTime;
}

export interface AnalysisCompletedEvent {
  jobId: string;
  proposalId: ProposalId;
  risk: RiskReport;
  flagged: boolean;
}

/** Event name -> payload. Clients join room "proposal:<id>" to receive them. */
export interface SocketEventMap {
  "analysis:progress": AnalysisProgressEvent;
  "analysis:completed": AnalysisCompletedEvent;
  "evidence:appended": EvidenceEntry;
  "proposal:flagged": FlagEvent;
}
