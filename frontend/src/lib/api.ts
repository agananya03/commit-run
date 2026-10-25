import { io, Socket } from "socket.io-client";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true" || true;

export interface Citation {
  chunkId: string;
  sha256: string;
  quote: string;
  sourceUri: string;
}

export interface Claim {
  id: string;
  text: string;
  kind: "financial" | "technical" | "team" | "timeline" | "other";
  citations: Citation[];
  support: "supported" | "unsupported" | "contradicted";
  pSupported: number;
}

export interface DecisionSummary {
  proposalId: string;
  tldr: string;
  treasuryImpact: {
    amountUsd: number | null;
    pctOfTreasury: number | null;
    recipients: string[];
    citations: Citation[];
  };
  dependencies: { text: string; citations: Citation[] }[];
  risks: { text: string; citations: Citation[] }[];
  claims: Claim[];
}

export interface IntentAction {
  kind: "transfer" | "upgrade" | "param_change" | "approve" | "call";
  target?: string;
  token?: string;
  amount?: string;
  recipient?: string;
  newImplementation?: string;
  functionSignature?: string;
  description: string;
  citations: Citation[];
}

export interface IntentSpec {
  proposalId: string;
  summary: string;
  actions: IntentAction[];
  explicitlyExcluded: string[];
  confidence: number;
}

export interface SimulationFinding {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  description: string;
  details?: any;
}

export interface SimulationResult {
  proposalId: string;
  success: boolean;
  gasUsed: number;
  findings: SimulationFinding[];
  decodedCalls: Array<{
    target: string;
    contractName?: string;
    selector: string;
    signature?: string;
    args: any[];
  }>;
  flagTriggered: boolean;
}

export interface Chunk {
  id: string;
  proposalId: string;
  sourceType: "forum" | "pdf" | "social" | "onchain";
  sourceUri: string;
  page?: number | null;
  text: string;
  sha256: string;
}

/**
 * Generic fetcher that reads from /shared/mocks via /api/mocks/[file]
 * when NEXT_PUBLIC_USE_MOCKS=true, else directly calls backend.
 */
async function fetchEndpoint<T>(
  backendPath: string,
  mockFileName: string
): Promise<T> {
  if (USE_MOCKS) {
    const res = await fetch(`/mocks/${mockFileName}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch mock /mocks/${mockFileName}: ${res.statusText}`);
    }
    return res.json();
  }

  const res = await fetch(`${BACKEND_URL}${backendPath}`);
  if (!res.ok) {
    throw new Error(`Backend error ${res.status} on ${backendPath}`);
  }
  return res.json();
}

export const api = {
  getDecisionSummary: async (proposalId: string): Promise<DecisionSummary> => {
    return fetchEndpoint<DecisionSummary>(
      `/proposals/${proposalId}/summary`,
      `summarize.${proposalId}.json`
    );
  },

  getIntentSpec: async (proposalId: string): Promise<IntentSpec> => {
    return fetchEndpoint<IntentSpec>(
      `/proposals/${proposalId}/intent`,
      `extract-intent.${proposalId}.json`
    );
  },

  getSimulationResult: async (proposalId: string): Promise<SimulationResult> => {
    return fetchEndpoint<SimulationResult>(
      `/proposals/${proposalId}/simulate`,
      `simulate.${proposalId}.json`
    );
  },

  getEvidenceChunks: async (proposalId: string): Promise<Chunk[]> => {
    return fetchEndpoint<Chunk[]>(
      `/proposals/${proposalId}/chunks`,
      `ingest.${proposalId}.json`
    );
  },

  getDeployments: async (): Promise<any> => {
    return fetchEndpoint<any>(`/deployments`, `deployments.json`);
  },
};

/**
 * Socket.IO client initialization for backend live progress and flags.
 */
let socketInstance: Socket | null = null;

export function getWatchdogSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(BACKEND_URL, {
      autoConnect: false,
      reconnectionAttempts: 5,
    });
  }
  return socketInstance;
}
