export type Hex = string;

export interface Chunk { id: string; proposalId: string; sourceType: 'forum'|'pdf'|'social'|'onchain'; sourceUri: string; page?: number; text: string; sha256: Hex }
export interface Citation { chunkId: string; sha256: Hex; quote: string; sourceUri: string }
export interface Claim { id: string; text: string; kind: 'financial'|'technical'|'team'|'timeline'|'other'; citations: Citation[]; support: 'supported'|'unsupported'|'contradicted'; pSupported: number }

export interface DecisionSummary { proposalId: string; tldr: string; treasuryImpact: { amountUsd: number|null; pctOfTreasury: number|null; recipients: string[]; citations: Citation[] }; dependencies: { text: string; citations: Citation[] }[]; risks: { text: string; citations: Citation[] }[]; claims: Claim[] }

export interface IntentAction { kind: 'transfer'|'upgrade'|'param_change'|'approve'|'call'; target?: string; token?: string; amount?: string; recipient?: string; newImplementation?: string; functionSignature?: string; description: string; citations: Citation[] }
export interface IntentSpec { proposalId: string; summary: string; actions: IntentAction[]; explicitlyExcluded: string[]; confidence: number }

export interface SimulationResult { proposalId: string; success: boolean; revertReason?: string;
  decodedCalls: { target: string; contractName?: string; selector: Hex; signature?: string; args: unknown[] }[];
  tokenTransfers: { token: string; from: string; to: string; amount: string }[];
  approvals: { token: string; owner: string; spender: string; amount: string }[];
  ownershipChanges: { contract: string; role: string; before: string; after: string }[];
  implementationChanges: { proxy: string; before: string; after: string; addedSelectors: { selector: Hex; signature?: string }[]; removedSelectors: { selector: Hex; signature?: string }[] }[];
  storageDiffs: { contract: string; slot: Hex; before: Hex; after: Hex }[];
  events: { contract: string; name: string; args: Record<string, unknown> }[];
  bytecodeHash: Hex; simHash: Hex }

export interface WalletLink { from: string; to: string; path: string[]; hops: number; pLink: number; reasons: string[] }
export interface CoiReport { proposalId: string; proposer: string; disclosed: string[]; signatureValid: boolean; undisclosedLinks: WalletLink[]; pCoi: number }

export interface Finding { id: string; severity: 'info'|'low'|'medium'|'high'|'critical'; category: 'recipient_mismatch'|'amount_mismatch'|'undeclared_action'|'ownership_change'|'unlimited_approval'|'new_privileged_function'|'coi'|'unsupported_claim'|'contradiction'; said: string; does: string; evidence: Citation[]; simRef?: string }
export interface RiskStage { stage: 'claims'|'coi'|'voting'|'execution'; probability: number; likelihoodRatio: number; explanation: string; findingIds: string[] }
export interface RiskChain { proposalId: string; prior: number; stages: RiskStage[]; posterior: number; level: 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'; action: 'none'|'review'|'halt' }

// ---------------------------------------------------------------------------
// Additions (proposed). Shapes follow the team plan's endpoint table and member prompts.
// Conventions: Hex is 0x-prefixed; addresses are 0x-prefixed strings; uint256 values are
// decimal strings; timestamps are ISO 8601 UTC; "not computed yet" is null.
// ---------------------------------------------------------------------------

// --- RAG requests / responses (B) ------------------------------------------

/** POST /ingest -> Chunk[] */
export interface IngestRequest { proposalId: string; files: { type: Chunk['sourceType']; path: string }[] }
/** POST /summarize -> DecisionSummary */
export interface SummarizeRequest { proposalId: string }
/** POST /extract-intent -> IntentSpec */
export interface ExtractIntentRequest { proposalId: string }
/** POST /search -> Chunk[] ranked by hybrid score (0.7 cosine + 0.3 BM25), filtered to proposalId */
export interface SearchRequest { proposalId: string; query: string; k?: number }
/** POST /explain -> Explanation */
export interface ExplainRequest { proposalId: string; findings: Finding[] }
export interface Explanation { headline: string; paragraph: string; perFinding: { findingId: string; sentence: string }[] }

// --- Sim requests / responses (C) ------------------------------------------

/** POST /simulate -> SimulationResult. Executed as the timelock on the Anvil fork. */
export interface SimulateRequest { proposalId: string; targets: string[]; values: string[]; calldatas: Hex[]; forkBlock?: number }

/** GET /deployments and /contracts/deployments/localhost.json. decimals only on token contracts. */
export interface Deployments { chainId: number; deployBlock: number; contracts: Record<string, { address: string; abi: unknown[]; decimals?: number }> }

// --- Backend: proposals, versions, evidence (A) ----------------------------

export type ProposalStatus = 'DRAFT'|'INGESTED'|'COMMITTED'|'ACTIVE'|'QUEUED'|'HALTED'|'EXECUTED'|'DEFEATED';

export interface Proposal { id: string; slug: string; title: string; proposer: string; status: ProposalStatus; governorProposalId: string|null; operationId: Hex|null; createdAt: string; updatedAt: string }

/** One evidence file of a version. proof = Merkle proof of leaf [type, sha256] in StandardMerkleTree. */
export interface EvidenceFile { type: Chunk['sourceType']|'disclosure'; uri: string; sha256: Hex; bytes: number; proof: Hex[] }

/**
 * versionHash = keccak256(RFC 8785 canonical JSON of canonicalJson); canonicalJson includes prevHash.
 * prevHash of version 1 is 0x00..00. Committed via ProposalRegistry.commit(...).
 */
export interface ProposalVersion { proposalId: string; version: number; canonicalJson: unknown; versionHash: Hex; prevHash: Hex; evidenceRoot: Hex; commitTxHash: Hex|null; files: EvidenceFile[]; createdAt: string }

/** Decoded log from Governor, GuardedTimelock, GovernanceGuard or ProposalRegistry. */
export interface ChainEvent { proposalId: string|null; contract: string; name: string; args: Record<string, unknown>; blockNumber: number; txHash: Hex; logIndex: number }

/** GET /proposals/:id: full bundle. */
export interface ProposalBundle { proposal: Proposal; versions: ProposalVersion[]; summary: DecisionSummary|null; intent: IntentSpec|null; simulation: SimulationResult|null; coi: CoiReport|null; findings: Finding[]; explanation: Explanation|null; risk: RiskChain|null; chainEvents: ChainEvent[]; flag: WatchdogFlag|null }

/** POST /proposals (JSON form; multipart upload of files is the other form). */
export interface CreateProposalRequest { slug: string }

/** POST /proposals/:id/commit */
export interface CommitResult { proposalId: string; version: number; versionHash: Hex; txHash: Hex; blockNumber: number }

/** POST /proposals/:id/run: starts the BullMQ flow. */
export interface RunResult { proposalId: string; flowId: string }

/**
 * POST /proposals/:id/disclosure -> CoiReport.
 * signature = EIP-191 personal_sign by proposer over the RFC 8785 canonical JSON string of
 * { proposalSlug, wallets (sorted), statement }; verified with ethers.verifyMessage.
 */
export interface DisclosureRequest { proposer: string; wallets: string[]; statement: string; signature: Hex }

/** POST /proposals/:id/reverify */
export interface ReverifyResult { allMatch: boolean; versions: { version: number; versionHash: Hex; onchainVersionHash: Hex|null; evidenceRootMatch: boolean; match: boolean }[]; simMatch: boolean; findingsMatch: boolean }

// --- Watchdog and live events (A) ------------------------------------------

/** watchdog:flag payload. findingsHash = keccak256(canonical JSON of findings), passed to GovernanceGuard.flag(). */
export interface WatchdogFlag { proposalId: string; operationId: Hex; findingsHash: Hex; findings: Finding[]; risk: RiskChain; txHash: Hex; blockNumber: number; flaggedAt: string }

export type PipelineStep = 'ingest'|'summarize'|'extractIntent'|'commit'|'coi'|'simulate'|'verdict'|'risk';
/** pipeline:progress payload. ms = step duration, set when completed or failed. */
export interface PipelineProgress { proposalId: string; step: PipelineStep; status: 'started'|'completed'|'failed'; ms?: number; error?: string }

/** Socket.IO event name -> payload. */
export interface SocketEvents { 'pipeline:progress': PipelineProgress; 'chain:event': ChainEvent; 'watchdog:flag': WatchdogFlag }

// --- Errors and health (all services) --------------------------------------

/** Body of every 4xx/5xx. UPSTREAM_INVALID = a rag/sim response failed zod validation in the backend. */
export interface ApiError { error: { code: 'VALIDATION_FAILED'|'NOT_FOUND'|'CONFLICT'|'UPSTREAM_UNAVAILABLE'|'UPSTREAM_INVALID'|'CHAIN_REVERT'|'INTERNAL'; message: string; details?: unknown } }

/** GET /health. Backend deps: postgres, redis, rpc, rag, sim. */
export interface Health { service: 'backend'|'rag'|'sim'; status: 'ok'|'degraded'; mocks: boolean; deps: Record<string, 'ok'|'down'> }
