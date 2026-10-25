"use client";

import React from "react";
import Link from "next/link";
import { useProposals } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { formatUSD } from "@/lib/utils";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Coins,
  Landmark,
  Layers,
} from "lucide-react";

export default function ProposalsIndexPage() {
  const { data: proposals, isLoading, error } = useProposals();

  const getRiskBadge = (risk?: string) => {
    switch (risk?.toUpperCase()) {
      case "CRITICAL":
        return (
          <Badge className="bg-red-950/80 text-red-400 border border-red-500/50 font-mono text-xs gap-1 px-2.5 py-0.5">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
            CRITICAL
          </Badge>
        );
      case "HIGH":
        return (
          <Badge className="bg-amber-950/80 text-amber-400 border border-amber-500/50 font-mono text-xs gap-1 px-2.5 py-0.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            HIGH
          </Badge>
        );
      case "MEDIUM":
        return (
          <Badge className="bg-yellow-950/80 text-yellow-400 border border-yellow-500/50 font-mono text-xs gap-1 px-2.5 py-0.5">
            <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />
            MEDIUM
          </Badge>
        );
      case "LOW":
      default:
        return (
          <Badge className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/50 font-mono text-xs gap-1 px-2.5 py-0.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            LOW
          </Badge>
        );
    }
  };

  const getStatusBadge = (status?: string) => {
    const s = (status || "ACTIVE").toUpperCase();
    if (s.includes("ACTIVE") || s === "VOTING ACTIVE") {
      return (
        <Badge className="bg-indigo-950/80 text-indigo-300 border border-indigo-700/60 font-mono text-[11px]">
          ACTIVE
        </Badge>
      );
    }
    if (s.includes("HALTED")) {
      return (
        <Badge className="bg-red-950/80 text-red-300 border border-red-700/60 font-mono text-[11px]">
          HALTED
        </Badge>
      );
    }
    if (s.includes("EXECUTED")) {
      return (
        <Badge className="bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[11px]">
          EXECUTED
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-800 text-slate-400 border border-slate-700 font-mono text-[11px]">
        {s}
      </Badge>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <span>Governance Proposals</span>
            <span className="text-xs font-mono font-normal bg-indigo-950/80 text-indigo-300 border border-indigo-800/80 px-2.5 py-0.5 rounded">
              Meridian DAO
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Automated intent verification, EVM calldata simulation, and conflict-of-interest watchdog.
          </p>
        </div>
      </div>

      {/* Loading Skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-5">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-slate-800 bg-slate-900/40 p-6 space-y-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-5 w-24 bg-slate-800 rounded" />
                <div className="flex gap-2">
                  <div className="h-5 w-16 bg-slate-800 rounded" />
                  <div className="h-5 w-20 bg-slate-800 rounded" />
                </div>
              </div>
              <div className="h-6 w-3/4 bg-slate-800 rounded" />
              <div className="h-14 w-full bg-slate-950/60 rounded border border-slate-800/80" />
              <div className="flex justify-between items-center pt-2 border-t border-slate-800/80">
                <div className="h-4 w-32 bg-slate-800 rounded" />
                <div className="h-8 w-28 bg-slate-800 rounded" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Card className="border-red-900/50 bg-red-950/20 p-6 text-center">
          <p className="text-red-400 font-mono text-sm">Failed to load proposals list: {(error as Error).message}</p>
        </Card>
      )}

      {/* Proposals Grid */}
      {!isLoading && proposals && (
        <div className="grid grid-cols-1 gap-5">
          {proposals.map((p) => {
            const risk = p.riskLevel?.toUpperCase() || "LOW";
            const isCritical = risk === "CRITICAL";
            const isHigh = risk === "HIGH";

            const hasFunds = p.amountUsd !== null && p.amountUsd !== undefined && p.amountUsd > 0;

            return (
              <Card
                key={p.slug}
                className={`border transition-all shadow-lg ${
                  isCritical
                    ? "border-red-900/60 bg-slate-950/90 hover:border-red-500/80"
                    : isHigh
                    ? "border-amber-900/50 bg-slate-950/90 hover:border-amber-500/70"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-700"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-indigo-400">
                        {p.slug}
                      </span>
                      <span className="text-slate-600">|</span>
                      <span className="font-mono text-xs text-slate-400">
                        Proposer: {p.proposer.slice(0, 10)}...{p.proposer.slice(-4)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(p.status)}
                      {getRiskBadge(p.riskLevel)}
                    </div>
                  </div>

                  <CardTitle className="text-lg text-slate-100 font-semibold leading-snug">
                    {p.title}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-3 pb-3 text-xs">
                  {/* Treasury Impact Block */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border border-slate-800/80 bg-slate-900/50 font-mono">
                    <div className="flex items-center gap-2">
                      <Coins className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <span className="text-slate-500 text-[11px] block">Requested Amount</span>
                        <span className="text-sm font-bold text-slate-100">
                          {hasFunds ? formatUSD(p.amountUsd as number) : "No funds requested (0 USDC)"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div>
                        <span className="text-slate-500 text-[11px] block">% of Treasury (20M USDC)</span>
                        <span className="text-sm font-bold text-indigo-300">
                          {p.pctOfTreasury !== null && p.pctOfTreasury !== undefined
                            ? `${p.pctOfTreasury}%`
                            : "0.0%"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <div className="text-[11px] font-mono text-slate-500 flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-slate-600" />
                    <span>Governor ID: {p.governorProposalId ? `${p.governorProposalId.slice(0, 8)}...` : "Pending"}</span>
                  </div>

                  <Link href={`/proposals/${p.slug}`}>
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium gap-1.5"
                    >
                      <span>Inspect Proposal</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
