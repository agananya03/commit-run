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