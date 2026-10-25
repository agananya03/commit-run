"use client";

import React, { useMemo } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Finding, RiskChain as RiskChainType } from "@/types/shared";

interface RiskChainProps {
  proposalId: string;
  /** The backend's risk chain (bundle.risk). Without it, the scenario presets below are shown. */
  risk?: RiskChainType | null;
  findings?: Finding[];
  onSelectTab?: (tab: string) => void;
}

type StageId = "claims" | "coi" | "voting" | "execution";
type Severity = "critical" | "high" | "low";
type Level = RiskChainType["level"];
type Action = RiskChainType["action"];

interface StageDetail {
  id: StageId;
  likelihoodRatio: number;
  probability: number;
  explanation: string;
  findingIds: string[];
  severity: Severity;
}

interface Scenario {
  prior: number;
  posterior: number;
  level: Level;
  action: Action;
  stages: StageDetail[];
}

const STAGE_ORDER: StageId[] = ["claims", "coi", "voting", "execution"];

const STAGE_META: Record<StageId, { title: string; short: string; Icon: typeof FileText }> = {
  claims: { title: "Proposal Claims", short: "Claims", Icon: FileText },
  coi: { title: "Conflict of Interest Risk", short: "COI", Icon: Users },
  voting: { title: "On-Chain Voting", short: "Voting", Icon: Vote },
  execution: { title: "Execution Discrepancy", short: "Execution", Icon: Terminal },
};

const stage = (id: StageId, likelihoodRatio: number, probability: number, explanation: string, findingId: string, severity: Severity): StageDetail => ({
  id,
  likelihoodRatio,
  probability,
  explanation,
  findingIds: [findingId],
  severity,
});

// Scenario-specific Bayesian data mirroring problem statement requirements (shown until the backend has a risk chain)
const PRESETS: Record<string, Scenario> = {
  "MIP-21": {
    prior: 0.05,
    posterior: 0.992,
    level: "CRITICAL",
    action: "halt",
    stages: [
      stage("claims", 4.2, 0.28, "Declared gas refactor explicitly promises 0 ownership changes and 0 new admin functions.", "ev_21_4", "high"),
      stage("coi", 6.8, 0.64, "Undisclosed 2.0 ETH seed funding path from Proposer (wallet 13) to Alt recipient (wallet 14).", "coi_21_1", "high"),
      stage("voting", 4.1, 0.88, "4 colluding whale delegators (wallets 18-21) control 61% voting power; denied diff requests.", "vote_21_1", "high"),
      stage("execution", 18.5, 0.992, "Calldata silently executes reinitializeV2() vault ownership transfer & infinite USDC approval.", "ev_21_1", "critical"),
    ],
  },
  "MIP-17": {
    prior: 0.05,
    posterior: 0.784,
    level: "HIGH",
    action: "review",
    stages: [
      stage("claims", 3.8, 0.24, "Contradiction detected: itemized budget describes $3,500,000 but calldata requests $5,000,000.", "ev_17_1", "high"),
      stage("coi", 7.5, 0.67, "Undisclosed funding link: Proposer 10 funded intermediary 11 who funded Nexus recipient 12.", "ev_17_2", "high"),
      stage("voting", 1.4, 0.74, "Split consensus: 3 core delegates raised concerns over missing 6-month milestone locks.", "vote_17_1", "high"),
      stage("execution", 1.2, 0.784, "Direct Treasury transfer matches raw request amount but violates disclosed milestone schedule.", "ev_17_1", "high"),
    ],
  },
  "MIP-12": {
    prior: 0.05,
    posterior: 0.012,
    level: "LOW",
    action: "none",
    stages: [
      stage("claims", 0.22, 0.032, "100% citation coverage for developer SDK grant deliverables, timeline, and multisig signers.", "ev_12_1", "low"),
      stage("coi", 0.18, 0.021, "Zero undisclosed wallet relationships detected across historical 90-day transfer graph.", "coi_12_1", "low"),
      stage("voting", 0.35, 0.016, "Broad decentralized community support with 89.2% approval and verified delegate quorum.", "vote_12_1", "low"),
      stage("execution", 0.12, 0.012, "Exact calldata match: 400,000 USDC transfer to disclosed grant recipient contract.", "ev_12_1", "low"),
    ],
  },
};

/** A stage is as severe as its worst linked finding, or its likelihood ratio when it has none. */
function severityOf(likelihoodRatio: number, findingIds: string[], findings: Finding[]): Severity {
  const linked = findingIds.map((id) => findings.find((f) => f.id === id)?.severity);
  if (linked.includes("critical") || likelihoodRatio >= 10) return "critical";
  if (linked.includes("high") || likelihoodRatio > 1) return "high";
  return "low";
}

/** The backend's chain, stage by stage; a stage it did not report counts as LR 1 (no evidence either way). */
function fromBackend(risk: RiskChainType, findings: Finding[]): Scenario {
  let odds = risk.prior / (1 - risk.prior);
  const stages = STAGE_ORDER.map((id): StageDetail => {
    const real = risk.stages.find((s) => s.stage === id);
    const likelihoodRatio = real?.likelihoodRatio ?? 1;
    odds *= likelihoodRatio;
    const findingIds = real?.findingIds ?? [];
    return {
      id,
      likelihoodRatio,
      probability: real?.probability ?? odds / (1 + odds),
      explanation: real?.explanation || "Not evaluated for this proposal.",
      findingIds,
      severity: severityOf(likelihoodRatio, findingIds, findings),
    };
  });
  return { prior: risk.prior, posterior: risk.posterior, level: risk.level, action: risk.action, stages };
}

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const fmtLr = (lr: number) => `${lr < 1 ? lr.toFixed(2) : lr.toFixed(1)}x`;
const ACTION_LABEL: Record<Action, string> = { halt: "HALT TIMELOCK", review: "SECURITY REVIEW", none: "NONE (PROCEED)" };
const TONE: Record<Level, { stroke: string; fill: string; dot: string }> = {
  CRITICAL: { stroke: "#ef4444", fill: "rgba(239, 68, 68, 0.4)", dot: "bg-red-400" },
  HIGH: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.4)", dot: "bg-amber-400" },
  MEDIUM: { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.4)", dot: "bg-amber-400" },
  LOW: { stroke: "#10b981", fill: "rgba(16, 185, 129, 0.4)", dot: "bg-emerald-400" },
};
const ICON_COLOR: Record<Severity, string> = { critical: "text-red-400", high: "text-indigo-400", low: "text-emerald-400" };

export function RiskChain({ proposalId, risk, findings = [], onSelectTab }: RiskChainProps) {
  const current = useMemo(() => (risk ? fromBackend(risk, findings) : PRESETS[proposalId] ?? null), [risk, findings, proposalId]);

  // Empty State if proposal has no risk chain yet
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

  const tone = TONE[current.level];
  const progressionPoints = [
    { label: "Prior", prob: Number((current.prior * 100).toFixed(1)) },
    ...current.stages.map((s) => ({ label: STAGE_META[s.id].short, prob: Number((s.probability * 100).toFixed(1)) })),
  ];

  const getLevelBadge = (level: Level) => {
    switch (level) {
      case "CRITICAL":
        return (
          <Badge className="bg-red-950/90 text-red-400 border border-red-500 font-mono text-sm sm:text-base font-bold px-3.5 py-1 gap-1.5 shadow-lg shadow-red-950/50">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            CRITICAL RISK
          </Badge>
        );
      case "HIGH":
      case "MEDIUM":
        return (
          <Badge className="bg-amber-950/90 text-amber-400 border border-amber-500 font-mono text-sm sm:text-base font-bold px-3.5 py-1 gap-1.5 shadow-lg shadow-amber-950/50">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            {level} RISK
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

  const getActionBadge = (action: Action) => {
    if (action === "halt") {
      return (
        <Badge className="bg-red-900/80 text-white border border-red-500/80 font-mono text-sm font-bold px-3 py-1">
          ACTION: {ACTION_LABEL[action]}
        </Badge>
      );
    }
    if (action === "review") {
      return (
        <Badge className="bg-amber-900/80 text-white border border-amber-500/80 font-mono text-sm font-bold px-3 py-1">
          ACTION: {ACTION_LABEL[action]}
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-900/80 text-white border border-emerald-500/80 font-mono text-sm font-bold px-3 py-1">
        ACTION: {ACTION_LABEL[action]}
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
              <span className="text-xs text-slate-400 font-mono">Prior: {pct(current.prior)}</span>
              <span className="text-slate-600">|</span>
              <span className={cn("text-xs font-mono", risk ? "text-emerald-400" : "text-slate-500")}>
                {risk ? "live from backend" : "scenario preset"}
              </span>
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
            const { title, Icon } = STAGE_META[stage.id];

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
                        <Icon className={cn("h-5 w-5", ICON_COLOR[stage.severity])} />
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
                      LR = {fmtLr(stage.likelihoodRatio)}
                    </Badge>
                  </div>

                  <h4 className="text-base sm:text-lg font-bold text-white mb-2 leading-tight">
                    {title}
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
                      {pct(stage.probability)}
                    </span>
                  </div>

                  {stage.findingIds.length > 0 && (
                    <div className="text-right">
                      <button
                        onClick={() => onSelectTab && onSelectTab(stage.id === "coi" ? "conflicts" : "execution")}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        <span>
                          Inspect finding ({stage.findingIds[0]}
                          {stage.findingIds.length > 1 ? ` +${stage.findingIds.length - 1}` : ""})
                        </span>
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
                <span>Prior: {pct(current.prior)}</span>
              </span>
              <span>➔</span>
              <span className="flex items-center gap-1.5 font-bold text-white">
                <span className={cn("w-2.5 h-2.5 rounded-full", tone.dot)} />
                <span>Posterior: {pct(current.posterior)}</span>
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
                  <stop offset="0%" stopColor={tone.fill} />
                  <stop offset="100%" stopColor="rgba(15, 23, 42, 0.0)" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="40" y1="20" x2="760" y2="20" stroke="#1e293b" strokeDasharray="4 4" />
              <line x1="40" y1="65" x2="760" y2="65" stroke="#1e293b" strokeDasharray="4 4" />
              <line x1="40" y1="110" x2="760" y2="110" stroke="#1e293b" strokeDasharray="4 4" />

              {/* Area Under Curve */}
              {(() => {
                const pts = progressionPoints;
                const coords = pts.map((p, i) => {
                  const x = 50 + (i / (pts.length - 1)) * 700;
                  // Map prob 0% -> 130, 100% -> 20
                  const y = 130 - (p.prob / 100) * 110;
                  return { x, y };
                });

                const pathD = coords.reduce((acc, c, i) => `${acc} ${i === 0 ? "M" : "L"} ${c.x} ${c.y}`, "");
                const areaD = `${pathD} L ${coords[coords.length - 1].x} 140 L ${coords[0].x} 140 Z`;

                return (
                  <>
                    <path d={areaD} fill={`url(#gradient-${proposalId})`} />
                    <path
                      d={pathD}
                      fill="none"
                      stroke={tone.stroke}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                    {coords.map((c, i) => (
                      <g key={i}>
                        <circle cx={c.x} cy={c.y} r="5" fill="#0f172a" stroke={tone.stroke} strokeWidth="3" />
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
