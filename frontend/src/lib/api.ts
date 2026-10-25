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
};

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
