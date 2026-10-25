"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { getWatchdogSocket } from "@/lib/api";
import type { ProposalVersion, ChainEvent, Hex } from "@/types/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  GitBranch,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Vote,
  FileText,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Layers,
  Radio,
  Box,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProposalTimelineProps {
  proposalId: string;
  versions?: ProposalVersion[];
  chainEvents?: ChainEvent[];
}

interface MiniExplorerTx {
  txHash: string;
  blockNumber: number;
  contract: string;
  eventName: string;
  args: Record<string, unknown>;
}

export function ProposalTimeline({
  proposalId,
  versions = [],
  chainEvents = [],
}: ProposalTimelineProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const isTampered = searchParams.get("tamper") === "1";

  // State for live events received via socket.io
  const [liveEvents, setLiveEvents] = useState<ChainEvent[]>([]);

  // State for mini block explorer dialog
  const [selectedTx, setSelectedTx] = useState<MiniExplorerTx | null>(null);

  // State for copied feedback
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // State for expanding collapsed votes
  const [showVoteDetails, setShowVoteDetails] = useState(false);

  // State for highlighting a version when scrolled to
  const [highlightedVersion, setHighlightedVersion] = useState<number | null>(null);

  // Copy helper
  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Toggle ?tamper=1 in URL
  const toggleTamper = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (isTampered) {
      params.delete("tamper");
    } else {
      params.set("tamper", "1");
    }
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  };

  // Smooth scroll and highlight previous version
  const scrollToVersion = (targetVersionNum: number) => {
    const el = document.getElementById(`version-card-${targetVersionNum}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedVersion(targetVersionNum);
      setTimeout(() => setHighlightedVersion(null), 2500);
    }
  };

  // Listen to socket event "chain:event" and append live
  useEffect(() => {
    let socket: ReturnType<typeof getWatchdogSocket> | null = null;
    try {
      socket = getWatchdogSocket();
      if (!socket.connected) {
        socket.connect();
      }

      const handleChainEvent = (event: ChainEvent) => {
        if (!event) return;
        // If event specifies proposalId, match or include
        if (event.proposalId && event.proposalId !== proposalId) return;

        setLiveEvents((prev) => [...prev, event]);

        // Invalidate queries to sync state
        queryClient.invalidateQueries({ queryKey: ["proposalBundle", proposalId] });
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
      };

      socket.on("chain:event", handleChainEvent);

      return () => {
        socket?.off("chain:event", handleChainEvent);
      };
    } catch {
      // Fail silently if socket can't connect
    }
  }, [proposalId, queryClient]);

  // Compute effective versions: if ?tamper=1, alter version[1].prevHash to demo red state
  const effectiveVersions = useMemo(() => {
    const list = [...versions];
    if (list.length === 0) {
      // Provide standard 2 versions for MIP-21 if empty
      list.push(
        {
          proposalId,
          version: 1,
          canonicalJson: {},
          versionHash: "0x4c1d763fe2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7",
          prevHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
          evidenceRoot: "0x91b05f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c",
          commitTxHash: "0x2f6a88d188d188d188d188d188d188d188d188d188d188d188d188d188d188d1",
          files: [],
          createdAt: "2026-10-22T09:12:05Z",
        },
        {
          proposalId,
          version: 2,
          canonicalJson: {},
          versionHash: "0x88e2c4a179d300f0d0381f2d41592c6725115a0ebea36488be4755e2b1b98649",
          prevHash: "0x4c1d763fe2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7e2a7",
          evidenceRoot: "0x91b05f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c",
          commitTxHash: "0x7b3d11a94e825a09b348ce5a182f55cab59ee15fdeefde5cf0f49af9496dead1",
          files: [],
          createdAt: "2026-10-23T14:30:00Z",
        }
      );
    }

    if (isTampered && list.length > 1) {
      return list.map((v, idx) => {
        if (idx === 1) {
          return {
            ...v,
            prevHash: "0xdeadbeefbadc0de0000000000000000000000000000000000000000000000000",
          };
        }
        return v;
      });
    }

    return list;
  }, [versions, proposalId, isTampered]);

  // Combine initial chainEvents with live socket events
  const allChainEvents = useMemo(() => {
    const combined = [...chainEvents, ...liveEvents];
    return combined;
  }, [chainEvents, liveEvents]);

  // Separate VoteCast events to collapse into one row: "N votes, X% for, by weight"
  const { voteEvents, nonVoteEvents, voteSummary } = useMemo(() => {
    const votes: ChainEvent[] = [];
    const others: ChainEvent[] = [];

    for (const ev of allChainEvents) {
      if (ev.name === "VoteCast") {
        votes.push(ev);
      } else {
        others.push(ev);
      }
    }

    let totalWeight = BigInt(0);
    let forWeight = BigInt(0);

    for (const v of votes) {
      const weightStr = v.args?.weight ? String(v.args.weight) : "1000000";
      const w = BigInt(weightStr);
      totalWeight += w;
      const support = Number(v.args?.support);
      if (support === 1) {
        forWeight += w;
      }
    }

    const forPct =
      totalWeight > BigInt(0)
        ? Number((forWeight * BigInt(10000)) / totalWeight) / 100
        : 100;

    return {
      voteEvents: votes,
      nonVoteEvents: others,
      voteSummary: {
        count: votes.length,
        forPct,
        totalWeight,
        forWeight,
        blockNumber: votes[0]?.blockNumber || 1060,
      },
    };
  }, [allChainEvents]);

  // Build interleaved timeline items sorted chronologically
  interface TimelineEntry {
    type: "version" | "event" | "vote_summary";
    sortKey: number; // approximate block or timestamp
    versionData?: {
      version: ProposalVersion;
      index: number;
      isBroken: boolean;
      prevVersionHash: string | null;
    };
    eventData?: ChainEvent;
  }

  const timelineEntries = useMemo(() => {
    const entries: TimelineEntry[] = [];

    // 1. Add versions
    effectiveVersions.forEach((v, idx) => {
      const prevVersion = idx > 0 ? effectiveVersions[idx - 1] : null;
      const isBroken =
        prevVersion !== null &&
        v.prevHash.toLowerCase() !== prevVersion.versionHash.toLowerCase();

      // Estimated block: 1000 + idx * 200
      const estBlock = 1000 + (v.version - 1) * 160;

      entries.push({
        type: "version",
        sortKey: estBlock,
        versionData: {
          version: v,
          index: idx,
          isBroken,
          prevVersionHash: prevVersion?.versionHash ?? null,
        },
      });
    });

    // 2. Add non-vote events
    nonVoteEvents.forEach((ev) => {
      entries.push({
        type: "event",
        sortKey: ev.blockNumber || 1100,
        eventData: ev,
      });
    });

    // 3. Add collapsed vote summary (if any votes exist)
    if (voteEvents.length > 0) {
      entries.push({
        type: "vote_summary",
        sortKey: voteSummary.blockNumber,
      });
    }

    // Sort by sortKey (block number)
    return entries.sort((a, b) => a.sortKey - b.sortKey);
  }, [effectiveVersions, nonVoteEvents, voteEvents, voteSummary]);

  return (
    <div className="space-y-6">
      {/* Top Controls Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900/70 shadow-lg">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Governance & Timelock Vertical Timeline</span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Interleaved immutable proposal registry versions and on-chain lifecycle events.
          </p>
        </div>

        {/* Tamper mode toggle */}
        <div className="flex items-center gap-3">
          {liveEvents.length > 0 && (
            <Badge className="bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 font-mono text-xs gap-1.5 animate-pulse">
              <Radio className="w-3 h-3 text-indigo-400 animate-spin" />
              {liveEvents.length} Live Socket Event(s)
            </Badge>
          )}

          <Button
            size="sm"
            variant={isTampered ? "destructive" : "outline"}
            onClick={toggleTamper}
            className={cn(
              "text-xs font-mono font-medium gap-1.5 h-8 transition-colors",
              isTampered
                ? "bg-red-900/90 hover:bg-red-800 text-white border-red-500"
                : "border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300"
            )}
          >
            <AlertTriangle className={cn("w-3.5 h-3.5", isTampered ? "text-white" : "text-amber-400")} />
            <span>{isTampered ? "Tamper Active (?tamper=1)" : "Simulate Tamper (?tamper=1)"}</span>
          </Button>
        </div>
      </div>

      {/* Main Timeline Stream */}
      <div className="relative pl-6 sm:pl-8 space-y-8 before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
        {timelineEntries.map((entry, index) => {
          // =================================================================
          // 1. VERSION CARD
          // =================================================================
          if (entry.type === "version" && entry.versionData) {
            const { version: v, isBroken, prevVersionHash } = entry.versionData;
            const isGenesis = v.version === 1 || v.prevHash === "0x0000000000000000000000000000000000000000000000000000000000000000";
            const isHighlighted = highlightedVersion === v.version;

            const shortVersionHash = `${v.versionHash.slice(0, 10)}...${v.versionHash.slice(-6)}`;
            const shortPrevHash = `${v.prevHash.slice(0, 10)}...${v.prevHash.slice(-6)}`;
            const shortEvidenceRoot = `${v.evidenceRoot.slice(0, 10)}...${v.evidenceRoot.slice(-6)}`;
            const shortTx = v.commitTxHash ? `${v.commitTxHash.slice(0, 10)}...${v.commitTxHash.slice(-6)}` : null;

            return (
              <div
                key={`version-${v.version}`}
                id={`version-card-${v.version}`}
                className={cn(
                  "relative group transition-all duration-500 rounded-xl",
                  isHighlighted && "ring-2 ring-indigo-400 bg-indigo-950/30 p-1"
                )}
              >
                {/* Timeline Node Icon */}
                <div
                  className={cn(
                    "absolute -left-6 sm:-left-8 -translate-x-1/2 top-4 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs transition-colors shadow-md",
                    isBroken
                      ? "border-red-500 bg-red-950 text-red-400 shadow-red-950/60"
                      : "border-indigo-500 bg-slate-900 text-indigo-300 shadow-indigo-950/50"
                  )}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                </div>

                {/* CHAIN BROKEN BANNER if prevHash mismatch */}
                {isBroken && (
                  <div className="mb-2 p-3 rounded-lg border-2 border-red-500 bg-red-950/90 text-red-100 flex items-center justify-between gap-3 shadow-lg shadow-red-950/50 animate-in fade-in">
                    <div className="flex items-center gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 stroke-[2.5]" />
                      <div>
                        <span className="font-bold text-xs uppercase tracking-wider block">
                          CHAIN BROKEN
                        </span>
                        <p className="text-[11px] text-red-200">
                          Version {v.version} prevHash ({shortPrevHash}) does not match Version {v.version - 1} versionHash ({prevVersionHash ? `${prevVersionHash.slice(0, 10)}...` : "unknown"})!
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-red-800 text-white font-mono text-[10px] uppercase font-bold shrink-0">
                      INTEGRITY VIOLATION
                    </Badge>
                  </div>
                )}

                {/* Version Card Body */}
                <div
                  className={cn(
                    "p-4 rounded-xl border bg-slate-900/90 shadow-lg space-y-3 transition-colors",
                    isBroken
                      ? "border-red-500/80 shadow-red-950/40"
                      : "border-slate-800 hover:border-indigo-700/60"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-indigo-300">
                        Proposal Version {v.version}
                      </span>
                      {isGenesis ? (
                        <Badge variant="outline" className="text-[10px] font-mono border-slate-700 text-slate-400">
                          Genesis Commit
                        </Badge>
                      ) : (
                        <Badge
                          className={cn(
                            "text-[10px] font-mono uppercase",
                            isBroken
                              ? "bg-red-950 text-red-400 border border-red-500"
                              : "bg-emerald-950/80 text-emerald-400 border border-emerald-600/60"
                          )}
                        >
                          {isBroken ? "Chain Broken" : "Chain Verified"}
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {new Date(v.createdAt).toLocaleDateString()} {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {/* Hash Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                    {/* versionHash (short + copy) */}
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                        versionHash
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-200 font-bold truncate" title={v.versionHash}>
                          {shortVersionHash}
                        </span>
                        <button
                          onClick={(e) => handleCopy(e, v.versionHash)}
                          className="text-slate-400 hover:text-slate-200 p-1"
                          title="Copy full versionHash"
                        >
                          {copiedHash === v.versionHash ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* prevHash (short, clickable: scrolls to and highlights previous version) */}
                    <div
                      className={cn(
                        "p-2.5 rounded-lg bg-slate-950 border space-y-1 transition-colors",
                        isBroken ? "border-red-500/80 bg-red-950/20" : "border-slate-800/80"
                      )}
                    >
                      <span className="text-slate-500 text-[10px] uppercase tracking-wider block flex items-center justify-between">
                        <span>prevHash</span>
                        {!isGenesis && (
                          <span className="text-[9px] text-indigo-400 font-normal">
                            Click to inspect
                          </span>
                        )}
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        {isGenesis ? (
                          <span className="text-slate-500 truncate">0x0000...0000 (Genesis)</span>
                        ) : (
                          <button
                            onClick={() => scrollToVersion(v.version - 1)}
                            className={cn(
                              "font-bold hover:underline transition-colors text-left flex items-center gap-1 truncate",
                              isBroken ? "text-red-400" : "text-indigo-400 hover:text-indigo-300"
                            )}
                            title={`Scroll to Version ${v.version - 1}`}
                          >
                            <span>{shortPrevHash}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleCopy(e, v.prevHash)}
                          className="text-slate-400 hover:text-slate-200 p-1 shrink-0"
                          title="Copy full prevHash"
                        >
                          {copiedHash === v.prevHash ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* evidenceRoot (short + copy) */}
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                        evidenceRoot
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-emerald-400 truncate" title={v.evidenceRoot}>
                          {shortEvidenceRoot}
                        </span>
                        <button
                          onClick={(e) => handleCopy(e, v.evidenceRoot)}
                          className="text-slate-400 hover:text-slate-200 p-1"
                          title="Copy full evidenceRoot"
                        >
                          {copiedHash === v.evidenceRoot ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* commit tx hash (clickable: opens mini block explorer dialog) */}
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 space-y-1">
                      <span className="text-slate-500 text-[10px] uppercase tracking-wider block flex items-center justify-between">
                        <span>Commit Tx Hash</span>
                        <span className="text-[9px] text-indigo-400 font-normal">
                          Explorer
                        </span>
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        {v.commitTxHash ? (
                          <button
                            onClick={() =>
                              setSelectedTx({
                                txHash: v.commitTxHash!,
                                blockNumber: 1000 + (v.version - 1) * 160,
                                contract: "ProposalRegistry",
                                eventName: "ProposalCommitted",
                                args: {
                                  proposalId: v.proposalId,
                                  version: v.version,
                                  versionHash: v.versionHash,
                                  prevHash: v.prevHash,
                                  evidenceRoot: v.evidenceRoot,
                                  commitTxHash: v.commitTxHash,
                                  timestamp: v.createdAt,
                                },
                              })
                            }
                            className="text-indigo-400 hover:text-indigo-300 font-bold hover:underline flex items-center gap-1 truncate text-left"
                            title="Open in Mini Block Explorer"
                          >
                            <span>{shortTx}</span>
                            <Box className="w-3 h-3 shrink-0" />
                          </button>
                        ) : (
                          <span className="text-slate-500">Uncommitted</span>
                        )}
                        {v.commitTxHash && (
                          <button
                            onClick={(e) => handleCopy(e, v.commitTxHash!)}
                            className="text-slate-400 hover:text-slate-200 p-1 shrink-0"
                            title="Copy Tx Hash"
                          >
                            {copiedHash === v.commitTxHash ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // =================================================================
          // 2. COLLAPSED VOTES SUMMARY ROW
          // =================================================================
          if (entry.type === "vote_summary") {
            return (
              <div key="vote-summary" className="relative group">
                {/* Node Icon */}
                <div className="absolute -left-6 sm:-left-8 -translate-x-1/2 top-3 w-7 h-7 rounded-full border-2 border-indigo-500/80 bg-slate-900 flex items-center justify-center text-indigo-300 shadow-md">
                  <Vote className="w-3.5 h-3.5" />
                </div>

                <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/80 shadow-md hover:border-slate-700 transition-colors">
                  <div
                    onClick={() => setShowVoteDetails(!showVoteDetails)}
                    className="flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2.5">
                      <Badge className="bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 font-mono text-[10px] uppercase">
                        VoteCast
                      </Badge>
                      <span className="font-mono text-xs font-semibold text-slate-100">
                        {voteSummary.count} votes, {voteSummary.forPct.toFixed(1)}% for, by weight
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                      <span>Block #{voteSummary.blockNumber}</span>
                      {showVoteDetails ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Expandable Individual Votes */}
                  {showVoteDetails && (
                    <div className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-xs font-mono animate-in fade-in">
                      {voteEvents.map((v, vi) => {
                        const voter = String(v.args?.voter || "0x00...");
                        const isFor = Number(v.args?.support) === 1;
                        const weight = Number(v.args?.weight || 0).toLocaleString();

                        return (
                          <div
                            key={vi}
                            className="p-2 rounded bg-slate-950 flex items-center justify-between gap-2 border border-slate-800/80 text-[11px]"
                          >
                            <span className="text-slate-300 truncate max-w-xs">{voter}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge
                                className={cn(
                                  "text-[9px] uppercase font-mono px-1.5 py-0",
                                  isFor
                                    ? "bg-emerald-950 text-emerald-400 border border-emerald-700/60"
                                    : "bg-red-950 text-red-400 border border-red-700/60"
                                )}
                              >
                                {isFor ? "FOR" : "AGAINST"}
                              </Badge>
                              <span className="text-slate-400 font-bold">{weight} votes</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          // =================================================================
          // 3. OTHER CHAIN EVENTS (ProposalCreated, ProposalQueued, Flagged, Executed)
          // =================================================================
          if (entry.type === "event" && entry.eventData) {
            const ev = entry.eventData;
            const isFlagged = ev.name === "Flagged";
            const isExecuted = ev.name === "Executed";
            const isQueued = ev.name === "ProposalQueued";

            const findingsHash = isFlagged ? String(ev.args?.findingsHash || "") : null;

            return (
              <div key={`event-${ev.name}-${ev.blockNumber}-${index}`} className="relative group">
                {/* Timeline Node Icon */}
                <div
                  className={cn(
                    "absolute -left-6 sm:-left-8 -translate-x-1/2 top-3 w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs shadow-md transition-colors",
                    isFlagged && "border-red-500 bg-red-950 text-red-400 shadow-red-950/60",
                    isExecuted && "border-emerald-500 bg-emerald-950 text-emerald-400 shadow-emerald-950/60",
                    !isFlagged && !isExecuted && "border-indigo-500 bg-slate-900 text-indigo-300 shadow-indigo-950/40"
                  )}
                >
                  {isFlagged && <ShieldAlert className="w-3.5 h-3.5" />}
                  {isExecuted && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {isQueued && <Clock className="w-3.5 h-3.5" />}
                  {!isFlagged && !isExecuted && !isQueued && <FileText className="w-3.5 h-3.5" />}
                </div>

                {/* Event Card Body */}
                <div
                  className={cn(
                    "p-4 rounded-xl border shadow-lg space-y-2.5 transition-colors",
                    isFlagged && "border-red-500 bg-red-950/90 text-red-100 shadow-red-950/50",
                    isExecuted && "border-emerald-500/60 bg-emerald-950/50 text-emerald-200",
                    !isFlagged && !isExecuted && "border-slate-800 bg-slate-900/80 hover:border-slate-700"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={cn(
                          "font-mono text-xs uppercase font-bold",
                          isFlagged && "bg-red-800 text-white border-red-600",
                          isExecuted && "bg-emerald-900/80 text-emerald-300 border-emerald-600/60",
                          !isFlagged && !isExecuted && "bg-indigo-950/80 text-indigo-300 border-indigo-700/60"
                        )}
                      >
                        {ev.name}
                      </Badge>
                      <span className="font-mono text-xs font-semibold">
                        {ev.contract}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                      <span>Block #{ev.blockNumber}</span>
                      <button
                        onClick={() =>
                          setSelectedTx({
                            txHash: ev.txHash,
                            blockNumber: ev.blockNumber,
                            contract: ev.contract,
                            eventName: ev.name,
                            args: ev.args,
                          })
                        }
                        className="text-indigo-400 hover:underline flex items-center gap-1"
                        title="Inspect Event Transaction"
                      >
                        <span>{ev.txHash.slice(0, 8)}...</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Flagged Event details (shows findingsHash in red) */}
                  {Boolean(isFlagged && findingsHash) && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-red-300 font-bold block">
                        findingsHash
                      </span>
                      <div className="p-2.5 rounded-lg bg-black/70 border border-red-500/60 flex items-center justify-between gap-2 font-mono text-xs text-red-300">
                        <span className="break-all select-all font-semibold">{findingsHash}</span>
                        <button
                          onClick={(e) => handleCopy(e, findingsHash || "")}
                          className="text-red-400 hover:text-white p-1 shrink-0"
                          title="Copy findingsHash"
                        >
                          {copiedHash === findingsHash ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ProposalQueued event details */}
                  {Boolean(isQueued && ev.args?.eta) && (
                    <div className="text-xs font-mono text-slate-300">
                      <span>Timelock Execution ETA: </span>
                      <span className="text-indigo-300 font-bold">
                        {new Date(Number(ev.args?.eta) * 1000).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {/* Executed event details */}
                  {isExecuted && (
                    <div className="text-xs font-mono text-emerald-300">
                      <span>Timelock transaction successfully executed on Meridian mainnet.</span>
                    </div>
                  )}

                  {/* Generic args summary if not flagged/queued */}
                  {Boolean(!isFlagged && !isQueued && !isExecuted && ev.args && Object.keys(ev.args).length > 0) && (
                    <div className="text-[11px] font-mono text-slate-400 bg-slate-950 p-2 rounded border border-slate-800 truncate">
                      {JSON.stringify(ev.args)}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>

      {/* Mini Block Explorer Dialog */}
      <Dialog open={selectedTx !== null} onOpenChange={(open) => !open && setSelectedTx(null)}>
        <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-slate-100 p-6">
          <DialogHeader className="border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Box className="w-5 h-5 text-indigo-400" />
              <DialogTitle className="text-base font-bold text-slate-100">
                Block Explorer: Transaction Details
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400">
              On-chain transaction execution log and decoded receipt event.
            </DialogDescription>
          </DialogHeader>

          {selectedTx && (
            <div className="space-y-4 pt-2 text-xs font-mono">
              {/* Tx Hash */}
              <div className="space-y-1">
                <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                  Transaction Hash
                </span>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-indigo-300 break-all select-all text-[11px]">
                    {selectedTx.txHash}
                  </span>
                  <button
                    onClick={(e) => handleCopy(e, selectedTx.txHash)}
                    className="p-1 rounded text-slate-400 hover:text-white"
                    title="Copy Tx Hash"
                  >
                    {copiedHash === selectedTx.txHash ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Block & Contract */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                    Block Number
                  </span>
                  <span className="font-bold text-slate-200 mt-0.5 block">
                    #{selectedTx.blockNumber}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                    Target Contract
                  </span>
                  <span className="font-bold text-indigo-300 mt-0.5 block">
                    {selectedTx.contract}
                  </span>
                </div>
              </div>

              {/* Event Name */}
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                  Emitted Event
                </span>
                <span className="font-bold text-emerald-400 mt-0.5 block">
                  {selectedTx.eventName}
                </span>
              </div>

              {/* Decoded Arguments */}
              <div className="space-y-1">
                <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                  Decoded Event Arguments (JSON)
                </span>
                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap max-h-48">
                  {JSON.stringify(selectedTx.args, null, 2)}
                </pre>
              </div>

              <div className="flex justify-end pt-1">
                <Button
                  size="sm"
                  onClick={() => setSelectedTx(null)}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs h-8"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
