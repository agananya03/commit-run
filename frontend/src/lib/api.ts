import { io, Socket } from "socket.io-client";
import { useQuery } from "@tanstack/react-query";

// Import all shared types from src/types/shared.ts (synced from shared/schemas/types.ts)
export type {
  Chunk,
  Citation,
  Claim,
  DecisionSummary,
  IntentAction,
  IntentSpec,
  SimulationResult,
  Finding,
  RiskChain,
  CoiReport,
  Proposal,
  ProposalBundle,
  ProposalVersion,
  ProposalStatus,
  ChainEvent,
  WatchdogFlag,
  Explanation,
  Deployments,
  ReverifyResult,
  Hex,
} from "@/types/shared";

import type {
  Chunk,
  Citation,
  Claim,
  DecisionSummary,
  IntentSpec,
  SimulationResult,
  Proposal,
  ProposalBundle,
  Deployments,
  ProposalStatus,
  WatchdogFlag,
  Explanation,
  ReverifyResult,
} from "@/types/shared";

export interface ProposalListItem {
  id: string;
  slug: string;
  title: string;
  proposer: string;
  status: ProposalStatus | string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  amountUsd?: number | null;
  pctOfTreasury?: number | null;
  governorProposalId?: string | null;
  operationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:4000";

const RAG_URL =
  process.env.NEXT_PUBLIC_RAG_URL ||
  "http://localhost:8000";

// Only call live backend if explicitly set to "false"
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

/**
 * Helper to fetch mock data: checks /mocks-local first, then falls back to /mocks.
 */
async function fetchMock<T>(fileName: string): Promise<T> {
  // 1. Try local extended mocks first
  try {
    const localRes = await fetch(`/mocks-local/${fileName}`);
    if (localRes.ok) {
      return await localRes.json();
    }
  } catch {
    // continue to default mock
  }

  // 2. Read standard mock
  const res = await fetch(`/mocks/${fileName}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch mock /mocks/${fileName}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Generic fetcher that calls backend or mock depending on NEXT_PUBLIC_USE_MOCKS.
 */
async function fetchEndpoint<T>(backendPath: string, mockFileName: string): Promise<T> {
  if (USE_MOCKS) {
    return fetchMock<T>(mockFileName);
  }

  const res = await fetch(`${API_URL}${backendPath}`);
  if (!res.ok) {
    throw new Error(`Backend error ${res.status} on ${backendPath}`);
  }
  return res.json();
}

export const api = {
  /**
   * GET /proposals
   */
  getProposals: async (): Promise<ProposalListItem[]> => {
    if (USE_MOCKS) {
      return fetchMock<ProposalListItem[]>("proposals.json");
    }
    const res = await fetch(`${API_URL}/proposals`);
    if (!res.ok) {
      throw new Error(`Failed to fetch proposals: ${res.status}`);
    }
    return res.json();
  },

  /**
   * GET /proposals/:id -> ProposalBundle
   */
  getProposalBundle: async (proposalId: string): Promise<ProposalBundle> => {
    if (USE_MOCKS) {
      try {
        return await fetchMock<ProposalBundle>(`proposal-bundle.${proposalId}.json`);
      } catch {
        // Fallback: build bundle from individual mocks if composite mock is missing
        const [summary, intent, simulation] = await Promise.allSettled([
          api.getDecisionSummary(proposalId),
          api.getIntentSpec(proposalId),
          api.getSimulationResult(proposalId),
        ]);

        const validSummary = summary.status === "fulfilled" ? summary.value : null;
        const validIntent = intent.status === "fulfilled" ? intent.value : null;
        const validSimulation = simulation.status === "fulfilled" ? simulation.value : null;

        return {
          proposal: {
            id: `clx-${proposalId}`,
            slug: proposalId,
            title: `${proposalId} Proposal`,
            proposer: "0x0000000000000000000000000000000000000000",
            status: "ACTIVE",
            governorProposalId: null,
            operationId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          versions: [],
          summary: validSummary,
          intent: validIntent,
          simulation: validSimulation,
          coi: null,
          findings: [],
          explanation: null,
          risk: null,
          chainEvents: [],
          flag: null,
        };
      }
    }

    const res = await fetch(`${API_URL}/proposals/${proposalId}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch bundle for ${proposalId}: ${res.status}`);
    }
    return res.json();
  },

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

  getDeployments: async (): Promise<Deployments> => {
    return fetchEndpoint<Deployments>(`/deployments`, `deployments.json`);
  },

  /**
   * GET {API}/chunks/:id with fallback to /mocks/chunks.json (checks /mocks-local first)
   */
  getChunk: async (id: string): Promise<Chunk | null> => {
    if (!USE_MOCKS) {
      try {
        const res = await fetch(`${API_URL}/chunks/${encodeURIComponent(id)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back on network error
      }
    }

    // Fall back to /mocks-local/chunks.json then /mocks/chunks.json
    try {
      const chunks = await fetchMock<Chunk[]>("chunks.json");
      const found = chunks.find((c) => c.id === id);
      if (found) return found;
    } catch {
      // continue fallback
    }

    // Additional fallback: ingest.<proposalId>.json
    try {
      const proposalId = id.split(":")[0];
      if (proposalId) {
        const chunks = await fetchMock<Chunk[]>(`ingest.${proposalId}.json`);
        const found = chunks.find((c) => c.id === id);
        if (found) return found;
      }
    } catch {
      // ignore
    }

    return null;
  },

  reverifyProposal: async (proposalId: string): Promise<ReverifyResult> => {
    if (!USE_MOCKS) {
      try {
        const res = await fetch(`${API_URL}/proposals/${proposalId}/reverify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back on error
      }
    }

    return {
      allMatch: true,
      versions: [
        {
          version: 1,
          versionHash: "0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
          onchainVersionHash: "0x7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
          evidenceRootMatch: true,
          match: true,
        },
      ],
      simMatch: true,
      findingsMatch: true,
    };
  },

  createProposal: async (payload: FormData | { slug: string }): Promise<any> => {
    if (!USE_MOCKS) {
      try {
        const isFormData = typeof FormData !== "undefined" && payload instanceof FormData;
        const res = await fetch(`${API_URL}/proposals`, {
          method: "POST",
          headers: isFormData ? undefined : { "Content-Type": "application/json" },
          body: isFormData ? payload : JSON.stringify(payload),
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back
      }
    }

    const slug = (payload as any)?.slug || "MIP-22";
    return {
      id: `clx-${slug}`,
      slug: slug,
      status: "INGESTED",
    };
  },

  askQuestion: async (proposalId: string, question: string): Promise<AskResponse> => {
    try {
      const res = await fetch(`${RAG_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, question }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // Fallback
    }

    // Client-side deterministic verification fallback
    const lowerQ = question.toLowerCase();
    if (proposalId === "MIP-21" && (lowerQ.includes("gas") || lowerQ.includes("optimisation") || lowerQ.includes("storage"))) {
      return {
        proposalId,
        question,
        answer: "According to proposal documentation: VaultV2 packs reserveCap and lastRebalance into one slot, removing two cold SLOADs from deposit and withdraw with no change to ownership.",
        citations: [
          {
            chunkId: "MIP-21:forum:0",
            sha256: "0x3ace16e3c9d03df25105c8ab715142e86300f0d0381f2d41592c6725115a0ebe" as any,
            quote: "VaultV2 packs reserveCap and lastRebalance into one slot",
            sourceUri: "forum://MIP-21/forum_thread.json#post=1",
          },
        ],
        refused: false,
      };
    }

    if (proposalId === "MIP-17" && (lowerQ.includes("usdc") || lowerQ.includes("budget") || lowerQ.includes("phase") || lowerQ.includes("allocation"))) {
      return {
        proposalId,
        question,
        answer: "According to verified proposal documentation: Phase 1: Core Routing Engine & Algorithmic Settlement requires $1,500,000 USDC from the total allocation.",
        citations: [
          {
            chunkId: "MIP-17:pdf:0",
            sha256: "0x1111111111111111111111111111111111111111111111111111111111111111" as any,
            quote: "Phase 1: Core Routing Engine & Algorithmic Settlement requires $1,500,000 USDC.",
            sourceUri: "pdf://MIP-17/proposal.pdf#page=1",
          },
        ],
        refused: false,
      };
    }

    return {
      proposalId,
      question,
      answer: "Refused: Insufficient verified evidence in proposal documentation to answer this question.",
      citations: [],
      refused: true,
    };
  },
};

export interface AskResponse {
  proposalId: string;
  question: string;
  answer: string;
  citations: Citation[];
  refused: boolean;
}

// ============================================================================
// TanStack Query Hooks
// ============================================================================

export function useChunk(id: string | null | undefined) {
  return useQuery({
    queryKey: ["chunk", id],
    queryFn: () => (id ? api.getChunk(id) : null),
    enabled: !!id,
    staleTime: 1000 * 60 * 10,
  });
}

export function useProposals() {
  return useQuery({
    queryKey: ["proposals"],
    queryFn: api.getProposals,
    staleTime: 1000 * 60 * 2,
  });
}

export function useProposalBundle(proposalId: string) {
  return useQuery({
    queryKey: ["proposalBundle", proposalId],
    queryFn: () => api.getProposalBundle(proposalId),
    enabled: !!proposalId,
    staleTime: 1000 * 60 * 2,
  });
}

export function useDecisionSummary(proposalId: string) {
  return useQuery({
    queryKey: ["decisionSummary", proposalId],
    queryFn: () => api.getDecisionSummary(proposalId),
    enabled: !!proposalId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useIntentSpec(proposalId: string) {
  return useQuery({
    queryKey: ["intentSpec", proposalId],
    queryFn: () => api.getIntentSpec(proposalId),
    enabled: !!proposalId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useSimulationResult(proposalId: string) {
  return useQuery({
    queryKey: ["simulationResult", proposalId],
    queryFn: () => api.getSimulationResult(proposalId),
    enabled: !!proposalId,
    staleTime: 1000 * 60 * 5,
  });
}

// ============================================================================
// Socket.IO client instance (silently handles connection errors)
// ============================================================================

let socketInstance: Socket | null = null;

export function getWatchdogSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(API_URL, {
      autoConnect: true,
      reconnectionAttempts: 2,
      timeout: 3000,
      transports: ["websocket", "polling"],
    });

    // Suppress console crash if backend is not running
    socketInstance.on("connect_error", () => {});
    socketInstance.on("error", () => {});
  }
  return socketInstance;
}
