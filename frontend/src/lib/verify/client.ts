"use client";

import { useEffect, useState } from "react";
import type { Board, ClaimCheck } from "@/lib/verify/factcheck";

// one request per proposal per page load: the detail page starts it early so the tab opens warm
const boards = new Map<string, Promise<Board>>();

async function post<T>(body: object): Promise<T> {
  const res = await fetch("/api/factcheck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Fact-check failed (${res.status})`);
  return json;
}

export function loadBoard(proposalId: string): Promise<Board> {
  if (!boards.has(proposalId)) {
    const p = post<Board>({ proposalId });
    p.catch(() => boards.delete(proposalId));
    boards.set(proposalId, p);
  }
  return boards.get(proposalId)!;
}

export function useFactCheck(proposalId: string): { board: Board | null; error: string | null } {
  const [state, setState] = useState<{ board: Board | null; error: string | null }>({ board: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ board: null, error: null });
    loadBoard(proposalId).then(
      (board) => live && setState({ board, error: null }),
      (e: Error) => live && setState({ board: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [proposalId]);
  return state;
}

export const checkClaim = (proposalId: string, claim: string) => post<ClaimCheck>({ proposalId, claim });
