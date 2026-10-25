"use client";

import { useQueries } from "@tanstack/react-query";
import { api, useProposals } from "@/lib/api";
import { buildRow, type RadarRow } from "@/lib/radar";

/** Every proposal plus its bundle (same cache key as useProposalBundle), most dangerous first. */
export function useRadarRows(): { rows: RadarRow[]; isLoading: boolean; error: Error | null } {
  const list = useProposals();
  const bundles = useQueries({
    queries: (list.data ?? []).map((p) => ({
      queryKey: ["proposalBundle", p.slug],
      queryFn: () => api.getProposalBundle(p.slug),
    })),
  });
  const rows = (list.data ?? [])
    .map((p, i) => buildRow(p, bundles[i]?.data))
    .sort((a, b) => (b.posterior ?? -1) - (a.posterior ?? -1));
  return { rows, isLoading: list.isLoading, error: (list.error as Error | null) ?? null };
}
