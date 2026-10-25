"use client";

import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { ShieldAlert, AlertTriangle, CheckCircle2, ArrowRight, FileCode2, Landmark, Users } from "lucide-react";

interface ProposalSummary {
  slug: string;
  title: string;
  category: string;
  status: string;
  risk: "CRITICAL" | "HIGH" | "LOW";
  proposer: string;
  beneficiary: string;
  scope: string;
  findingsCount: number;
  criticalNotice: string | null;
}

const PROPOSAL_LIST: ProposalSummary[] = [
  {
    slug: "MIP-21",
    title: "VaultV2: storage packing and gas optimisation",
    category: "Core Vault Upgrade",
    status: "Voting Active",
    risk: "CRITICAL",
    proposer: "kestrel.eth (walletIndex 13)",
    beneficiary: "Alt Wallet 14 (Hidden Ownership Transfer)",
    scope: "Slot packing, SLOAD reduction, EIP-2929 benchmarks",
    findingsCount: 3,
    criticalNotice: "CRITICAL: Simulated bytecode transfer of Vault ownership & unlimited USDC Treasury approval to wallet 14.",
  },
  {
    slug: "MIP-17",
    title: "Nexus Labs Ecosystem Acceleration & Cross-Chain Liquidity",
    category: "Ecosystem Grant",
    status: "Voting Active",
    risk: "HIGH",
    proposer: "Orion Strategic (walletIndex 10)",
    beneficiary: "Nexus Labs Collective (walletIndex 12)",
    scope: "Cross-chain messaging rails and MEV protection",
    findingsCount: 2,
    criticalNotice: "HIGH: $1.5M budget mismatch (Summary states $5.0M; itemized table totals $3.5M). Undisclosed seed funding trail.",
  },
  {
    slug: "MIP-12",
    title: "Developer SDK and Subgraph Indexer Infrastructure Grant",
    category: "Tooling & Infra",
    status: "Executed",
    risk: "LOW",
    proposer: "Ecosystem Lead (walletIndex 8)",
    beneficiary: "Meridian Studio Collective (walletIndex 9)",
    scope: "Official TypeScript SDK & open-source subgraph indexer",
    findingsCount: 0,
    criticalNotice: null,
  },
];

export default function ProposalsIndexPage() {
  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case "CRITICAL":
        return (
          <Badge className="bg-red-950/80 text-red-400 border border-red-500/60 font-mono text-xs gap-1 px-2.5 py-0.5">
            <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
            CRITICAL RISK
          </Badge>
        );
      case "HIGH":
        return (
          <Badge className="bg-amber-950/80 text-amber-400 border border-amber-500/60 font-mono text-xs gap-1 px-2.5 py-0.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            HIGH RISK
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-800 text-slate-300 border border-slate-700 font-mono text-xs gap-1 px-2.5 py-0.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            LOW RISK
          </Badge>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    if (status.includes("Active")) {
      return (
        <Badge className="bg-indigo-950/70 text-indigo-300 border border-indigo-700/60 font-mono text-[11px]">
          {status}
        </Badge>
      );
    }
    return (
      <Badge className="bg-slate-800 text-slate-400 border border-slate-700 font-mono text-[11px]">
        {status}
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
            <span className="text-xs font-mono font-normal bg-indigo-950/80 text-indigo-300 border border-indigo-800/80 px-2 py-0.5 rounded">
              Meridian DAO
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Automated intent verification, EVM calldata simulation, and conflict-of-interest graph analysis.
          </p>
        </div>
      </div>

      {/* Proposals Grid */}
      <div className="grid grid-cols-1 gap-5">
        {PROPOSAL_LIST.map((p) => {
          const isCritical = p.risk === "CRITICAL";
          const isHigh = p.risk === "HIGH";

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
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-bold text-indigo-400">
                      {p.slug}
                    </span>
                    <span className="text-slate-600">|</span>
                    <span className="text-xs text-slate-400 font-medium">
                      {p.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(p.status)}
                    {getRiskBadge(p.risk)}
                  </div>
                </div>

                <CardTitle className="text-lg text-slate-100 font-semibold leading-snug">
                  {p.title}
                </CardTitle>
                <CardDescription className="text-xs text-slate-400 line-clamp-1">
                  Scope: {p.scope}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3 pb-3 text-xs">
                {/* Critical Alert Notice if applicable */}
                {p.criticalNotice && (
                  <div
                    className={`p-2.5 rounded-md border text-xs font-mono leading-relaxed ${
                      isCritical
                        ? "bg-red-950/40 border-red-500/40 text-red-300"
                        : "bg-amber-950/30 border-amber-500/30 text-amber-300"
                    }`}
                  >
                    {p.criticalNotice}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300 font-mono text-[11px] bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-500">Proposer:</span>
                    <span className="truncate text-slate-200">{p.proposer}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Landmark className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-500">Beneficiary:</span>
                    <span className="truncate text-slate-200">{p.beneficiary}</span>
                  </div>
                </div>
              </CardContent>

              <CardFooter className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <div className="text-[11px] font-mono text-slate-500">
                  {p.findingsCount > 0 ? (
                    <span className={isCritical ? "text-red-400 font-medium" : "text-amber-400 font-medium"}>
                      {p.findingsCount} anomaly finding(s) detected
                    </span>
                  ) : (
                    <span className="text-emerald-400">0 anomalies detected</span>
                  )}
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
    </div>
  );
}
