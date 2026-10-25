"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { getWatchdogSocket } from "@/lib/api";
import { useRadarRows } from "@/lib/useRadar";
import type { ChainEvent, Health, WatchdogFlag } from "@/types/shared";

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";
const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

interface StripEvent {
  key: string;
  text: string;
  danger: boolean;
}

/**
 * Sticky status line above every screen, in plain words: is the watchdog on, did it stop anything, what just
 * happened on-chain (live mode), and whether this is demo data.
 */
export function MonitorStrip() {
  const { rows } = useRadarRows();
  const halted = rows.filter((r) => r.state === "HALTED");
  const [last, setLast] = useState<StripEvent | null>(null);

  const health = useQuery({
    queryKey: ["backendHealth"],
    enabled: !USE_MOCKS,
    refetchInterval: 10_000,
    queryFn: async (): Promise<Health | null> => {
      try {
        const res = await fetch(`${API_URL}/health`);
        return res.ok ? ((await res.json()) as Health) : null;
      } catch {
        return null;
      }
    },
  });

  useEffect(() => {
    if (USE_MOCKS) return;
    const socket = getWatchdogSocket();
    socket.emit("subscribe", { proposalId: "*" });
    const onChain = (e: ChainEvent) =>
      setLast({ key: `${e.txHash}:${e.logIndex}`, danger: false, text: `${e.name}${e.proposalId ? ` · ${e.proposalId}` : ""} · block ${e.blockNumber}` });
    const onFlag = (f: WatchdogFlag) => setLast({ key: f.txHash, danger: true, text: `${f.proposalId} frozen by the watchdog · block ${f.blockNumber}` });
    socket.on("chain:event", onChain);
    socket.on("watchdog:flag", onFlag);
    return () => {
      socket.off("chain:event", onChain);
      socket.off("watchdog:flag", onFlag);
    };
  }, []);

  const source = USE_MOCKS
    ? { label: "Demo data", cls: "text-caution border-caution/40 bg-caution/10" }
    : health.data
    ? { label: health.data.status === "ok" ? "Live" : "Live · degraded", cls: health.data.status === "ok" ? "text-verified border-verified/40 bg-verified/10" : "text-caution border-caution/40 bg-caution/10" }
    : { label: health.data === null ? "Backend offline" : "Connecting…", cls: "text-muted border-line" };

  return (
    <div className="no-print sticky top-0 z-30 flex h-11 items-center gap-4 border-b border-line/70 bg-canvas/75 px-4 text-xs backdrop-blur-xl select-none sm:px-8">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className={cn("motion-safe-only absolute inline-flex h-full w-full animate-ping rounded-full opacity-50", halted.length ? "bg-danger" : "bg-verified")} />
          <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", halted.length ? "bg-danger" : "bg-verified")} />
        </span>
        {halted.length > 0 ? (
          <Link href={`/proposals/${halted[0]!.slug}`} className="font-medium text-danger hover:underline">
            Watchdog stopped {halted.map((h) => h.slug).join(", ")}
          </Link>
        ) : (
          <span className="font-medium text-ink">Watchdog is on</span>
        )}
      </div>

      <div className="min-w-0 flex-1 truncate text-right font-code text-[11px]">
        {last && (
          <span key={last.key} className={cn("animate-strip-in", last.danger ? "text-danger" : "text-evidence")}>
            {last.text}
          </span>
        )}
      </div>

      <span className={cn("flex-shrink-0 rounded-full border px-3 py-1 font-medium", source.cls)}>{source.label}</span>
    </div>
  );
}
