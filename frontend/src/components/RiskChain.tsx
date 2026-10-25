"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Users,
  Vote,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  FileQuestion,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RiskChainProps {
  proposalId: string;
  onSelectTab?: (tab: string) => void;
}

interface StageDetail {
  id: string;
  title: string;
  icon: React.ReactNode;
  lr: string;
  runningProb: string;
  explanation: string;
  findingId?: string;
  severity: "critical" | "high" | "low";
}

export function RiskChain({ proposalId, onSelectTab }: RiskChainProps) {
  // Scenario-specific Bayesian data mirroring problem statement requirements
  const scenarios: Record<
    string,
    {
      prior: string;
      finalProb: string;
      level: "CRITICAL" | "HIGH" | "LOW";
      action: "HALT TIMELOCK" | "SECURITY REVIEW" | "NONE (PROCEED)";
      stages: StageDetail[];
      progressionPoints: { label: string; prob: number }[];
    }
  > = {
    "MIP-21": {
      prior: "5.0%",
      finalProb: "99.2%",
      level: "CRITICAL",
      action: "HALT TIMELOCK",
      progressionPoints: [
        { label: "Prior", prob: 5 },
        { label: "Claims", prob: 28 },
        { label: "COI", prob: 64 },
        { label: "Voting", prob: 88 },
        { label: "Execution", prob: 99.2 },
      ],
      stages: [
        {
          id: "stage-1",
          title: "Proposal Claims",
          icon: <FileText className="h-5 w-5 text-indigo-400" />,
          lr: "LR = 4.2x",
          runningProb: "28.0%",
          explanation: "Declared gas refactor explicitly promises 0 ownership changes and 0 new admin functions.",
          findingId: "ev_21_4",
          severity: "high",
        },
        {
          id: "stage-2",
          title: "Conflict of Interest Risk",
          icon: <Users className="h-5 w-5 text-indigo-400" />,
          lr: "LR = 6.8x",
          runningProb: "64.0%",
          explanation: "Undisclosed 2.0 ETH seed funding path from Proposer (wallet 13) to Alt recipient (wallet 14).",
          findingId: "coi_21_1",
          severity: "high",
        },
        {
          id: "stage-3",
          title: "On-Chain Voting",
          icon: <Vote className="h-5 w-5 text-indigo-400" />,
          lr: "LR = 4.1x",
          runningProb: "88.0%",
          explanation: "4 colluding whale delegators (wallets 18-21) control 61% voting power; denied diff requests.",
          findingId: "vote_21_1",
          severity: "high",
        },
        {
          id: "stage-4",
          title: "Execution Discrepancy",
          icon: <Terminal className="h-5 w-5 text-red-400" />,
          lr: "LR = 18.5x",
          runningProb: "99.2%",
          explanation: "Calldata silently executes reinitializeV2() vault ownership transfer & infinite USDC approval.",
          findingId: "ev_21_1",
          severity: "critical",
        },
      ],
    },
    "MIP-17": {
      prior: "5.0%",
      finalProb: "78.4%",
      level: "HIGH",
      action: "SECURITY REVIEW",
      progressionPoints: [
        { label: "Prior", prob: 5 },
        { label: "Claims", prob: 24 },
        { label: "COI", prob: 67 },
        { label: "Voting", prob: 74 },
        { label: "Execution", prob: 78.4 },
      ],
      stages: [
        {
          id: "stage-1",
          title: "Proposal Claims",
          icon: <FileText className="h-5 w-5 text-indigo-400" />,
          lr: "LR = 3.8x",
          runningProb: "24.0%",
          explanation: "Contradiction detected: itemized budget describes $3,500,000 but calldata requests $5,000,000.",
          findingId: "ev_17_1",
          severity: "high",
        },
        {
          id: "stage-2",
          title: "Conflict of Interest Risk",
          icon: <Users className="h-5 w-5 text-amber-400" />,
          lr: "LR = 7.5x",
          runningProb: "67.0%",
          explanation: "Undisclosed funding link: Proposer 10 funded intermediary 11 who funded Nexus recipient 12.",
          findingId: "ev_17_2",
          severity: "high",
        },
        {
          id: "stage-3",
          title: "On-Chain Voting",
          icon: <Vote className="h-5 w-5 text-indigo-400" />,
          lr: "LR = 1.4x",
          runningProb: "74.0%",
          explanation: "Split consensus: 3 core delegates raised concerns over missing 6-month milestone locks.",
          findingId: "vote_17_1",
          severity: "high",
        },
        {
          id: "stage-4",
          title: "Execution Discrepancy",
          icon: <Terminal className="h-5 w-5 text-indigo-400" />,
          lr: "LR = 1.2x",
          runningProb: "78.4%",
          explanation: "Direct Treasury transfer matches raw request amount but violates disclosed milestone schedule.",
          findingId: "ev_17_1",
          severity: "high",
        },
      ],
    },
    "MIP-12": {
      prior: "5.0%",
      finalProb: "1.2%",
      level: "LOW",
      action: "NONE (PROCEED)",
      progressionPoints: [
        { label: "Prior", prob: 5 },
        { label: "Claims", prob: 3.2 },
        { label: "COI", prob: 2.1 },
        { label: "Voting", prob: 1.6 },
        { label: "Execution", prob: 1.2 },
      ],
      stages: [
        {
          id: "stage-1",
          title: "Proposal Claims",
          icon: <FileText className="h-5 w-5 text-emerald-400" />,
          lr: "LR = 0.22x",
          runningProb: "3.2%",
          explanation: "100% citation coverage for developer SDK grant deliverables, timeline, and multisig signers.",
          findingId: "ev_12_1",
          severity: "low",
        },
        {
          id: "stage-2",
          title: "Conflict of Interest Risk",
          icon: <Users className="h-5 w-5 text-emerald-400" />,
          lr: "LR = 0.18x",
          runningProb: "2.1%",
          explanation: "Zero undisclosed wallet relationships detected across historical 90-day transfer graph.",
          findingId: "coi_12_1",
          severity: "low",
        },
        {
          id: "stage-3",
          title: "On-Chain Voting",
          icon: <Vote className="h-5 w-5 text-emerald-400" />,
          lr: "LR = 0.35x",
          runningProb: "1.6%",
          explanation: "Broad decentralized community support with 89.2% approval and verified delegate quorum.",
          findingId: "vote_12_1",
          severity: "low",
        },
        {
          id: "stage-4",
          title: "Execution Discrepancy",
          icon: <Terminal className="h-5 w-5 text-emerald-400" />,
          lr: "LR = 0.12x",
          runningProb: "1.2%",
          explanation: "Exact calldata match: 400,000 USDC transfer to disclosed grant recipient contract.",
          findingId: "ev_12_1",
          severity: "low",
        },
      ],
    },
  };

  const current = scenarios[proposalId];

  // Empty State if proposal has no risk chain scenario
  if (!current) {
    return (
      <Card className="border-slate-800 bg-slate-900/60 p-8 text-center shadow-xl">
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3 rounded-full bg-slate-800/80 border border-slate-700 text-slate-400">
            <FileQuestion className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-slate-200">
            No Bayesian Risk Audit for {proposalId}
          </h3>
          <p className="text-sm text-slate-400 max-w-md">
            The probabilistic risk engine has not evaluated this proposal yet. Run ingestion or select a known scenario (MIP-12, MIP-17, or MIP-21).
          </p>
        </div>
      </Card>
    );
  }

  const getLevelBadge = (level: string) => {
    switch (level) {
      case "CRITICAL":
        return (
          <Badge className="bg-red-950/90 text-red-400 border border-red-500 font-mono text-sm sm:text-base font-bold px-3.5 py-1 gap-1.5 shadow-lg shadow-red-950/50">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            CRITICAL RISK
          </Badge>
        );
      case "HIGH":
        return (
          <Badge className="bg-amber-950/90 text-amber-400 border border-amber-500 font-mono text-sm sm:text-base font-bold px-3.5 py-1 gap-1.5 shadow-lg shadow-amber-950/50">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            HIGH RISK
          </Badge>
        );
      default:
        return (
          <Badge className="bg-emerald-950/90 text-emerald-400 border border-emerald-500 font-mono text-sm sm:text-base font-bold px-3.5 py-1 gap-1.5 shadow-lg shadow-emerald-950/50">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            LOW RISK
          </Badge>
        );
    }
  };

  const getActionBadge = (action: string) => {
    if (action.includes("HALT")) {
      return (
        <Badge className="bg-red-900/80 text-white border border-red-500/80 font-mono text-sm font-bold px-3 py-1">
          ACTION: {action}
        </Badge>
      );
    }
    if (action.includes("REVIEW")) {
      return (
        <Badge className="bg-amber-900/80 text-white border border-amber-500/80 font-mono text-sm font-bold px-3 py-1">
          ACTION: {action}
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-900/80 text-white border border-emerald-500/80 font-mono text-sm font-bold px-3 py-1">
        ACTION: {action}
      </Badge>
    );
  };

  return (
    <Card className="border-slate-800 bg-slate-900/60 shadow-2xl">
      {/* Header with Projector-Ready Type */}
      <CardHeader className="pb-4 border-b border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs uppercase tracking-widest text-indigo-400 font-bold">
                Bayesian Probabilistic Watchdog
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-xs text-slate-400 font-mono">Prior: {current.prior}</span>
            </div>
            <CardTitle className="text-lg sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              <span>4-Stage Risk Progression Chain</span>
              <Badge variant="outline" className="text-xs font-mono border-slate-700 text-slate-300">
                P(Malicious | Evidence)
              </Badge>
            </CardTitle>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {getLevelBadge(current.level)}
            {getActionBadge(current.action)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-5">
        {/* 4 Connected Stage Cards - Large Type for Projector */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {current.stages.map((stage, idx) => {
            const isCritical = stage.severity === "critical";
            const isHigh = stage.severity === "high";

            const cardBorder = isCritical
              ? "border-red-500/80 bg-red-950/20 shadow-red-950/30"
              : isHigh
              ? "border-amber-500/70 bg-amber-950/15 shadow-amber-950/30"
              : "border-slate-800 bg-slate-950/70";

            return (
              <div
                key={stage.id}
                className={cn(
                  "p-5 rounded-xl border flex flex-col justify-between shadow-xl transition-all relative",
                  cardBorder
                )}
              >
                {/* Stage Header */}
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800">
                        {stage.icon}
                      </div>
                      <span className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
                        Stage {idx + 1}
                      </span>
                    </div>

                    <Badge
                      className={cn(
                        "font-mono text-xs font-bold px-2 py-0.5",
                        isCritical
                          ? "bg-red-950 text-red-400 border border-red-500/60"
                          : isHigh
                          ? "bg-amber-950 text-amber-400 border border-amber-500/60"
                          : "bg-emerald-950 text-emerald-400 border border-emerald-500/60"
                      )}
                    >
                      {stage.lr}
                    </Badge>
                  </div>

                  <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-tight">
                    {stage.title}
                  </h4>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans mb-3">
                    {stage.explanation}
                  </p>
                </div>

                {/* Card Bottom: Running Probability and Finding Link */}
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-mono">Running Risk:</span>
                    <span
                      className={cn(
                        "font-mono text-xl sm:text-2xl font-black",
                        isCritical
                          ? "text-red-400"
                          : isHigh
                          ? "text-amber-400"
                          : "text-emerald-400"
                      )}
                    >
                      {stage.runningProb}
                    </span>
                  </div>

                  {stage.findingId && (
                    <div className="text-right">
                      <button
                        onClick={() => onSelectTab && onSelectTab("execution")}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        <span>Inspect finding ({stage.findingId})</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* SVG Probability Progression Chart - Crisp & Visible from across the room */}
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-950/80 shadow-lg space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <h4 className="text-sm sm:text-base font-semibold text-slate-200">
                Stage-by-Stage Posterior Probability Progression
              </h4>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                <span>Prior: {current.prior}</span>
              </span>
              <span>➔</span>
              <span className="flex items-center gap-1.5 font-bold text-white">
                <span
                  className={cn(
                    "w-2.5 h-2.5 rounded-full",
                    current.level === "CRITICAL"
                      ? "bg-red-400"
                      : current.level === "HIGH"
                      ? "bg-amber-400"
                      : "bg-emerald-400"
                  )}
                />
                <span>Posterior: {current.finalProb}</span>
              </span>
            </div>
          </div>

          {/* Responsive SVG Progression Visualization */}
          <div className="relative pt-2 pb-1">
            <svg
              viewBox="0 0 800 160"
              className="w-full h-32 overflow-visible select-none"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={`gradient-${proposalId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={
                      current.level === "CRITICAL"
                        ? "rgba(239, 68, 68, 0.4)"
                        : current.level === "HIGH"
                        ? "rgba(245, 158, 11, 0.4)"
                        : "rgba(16, 185, 129, 0.4)"
                    }
                  />
                  <stop offset="100%" stopColor="rgba(15, 23, 42, 0.0)" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="40" y1="20" x2="760" y2="20" stroke="#1e293b" strokeDasharray="4 4" />
              <line x1="40" y1="65" x2="760" y2="65" stroke="#1e293b" strokeDasharray="4 4" />
              <line x1="40" y1="110" x2="760" y2="110" stroke="#1e293b" strokeDasharray="4 4" />

              {/* Area Under Curve */}
              {(() => {
                const pts = current.progressionPoints;
                const coords = pts.map((p, i) => {
                  const x = 50 + (i / (pts.length - 1)) * 700;
                  // Map prob 0% -> 130, 100% -> 20
                  const y = 130 - (p.prob / 100) * 110;
                  return { x, y };
                });

                const pathD = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? "M" : "L"} ${c.x} ${c.y}`, "");
                const areaD = `${pathD} L ${coords[coords.length - 1].x} 140 L ${coords[0].x} 140 Z`;

                const strokeColor =
                  current.level === "CRITICAL"
                    ? "#ef4444"
                    : current.level === "HIGH"
                    ? "#f59e0b"
                    : "#10b981";

                return (
                  <>
                    <path d={areaD} fill={`url(#gradient-${proposalId})`} />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    {coords.map((c, i) => (
                      <g key={i}>
                        <circle cx={c.x} cy={c.y} r="5" fill="#0f172a" stroke={strokeColor} strokeWidth="3" />
                        <text
                          x={c.x}
                          y={c.y - 12}
                          textAnchor="middle"
                          className="font-mono text-[12px] font-bold fill-slate-200"
                        >
                          {pts[i].prob}%
                        </text>
                        <text
                          x={c.x}
                          y="152"
                          textAnchor="middle"
                          className="font-mono text-[11px] fill-slate-400"
                        >
                          {pts[i].label}
                        </text>
                      </g>
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
