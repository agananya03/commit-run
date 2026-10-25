"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Users,
  Vote,
  Terminal,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  ExternalLink,
  HelpCircle,
  TrendingUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Finding, RiskChain as RiskChainType, RiskStage } from "@/types/shared";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from "recharts";

interface RiskChainProps {
  proposalId: string;
  risk?: RiskChainType | null;
  findings?: Finding[];
}

interface StageDetail {
  id: "claims" | "coi" | "voting" | "execution";
  stageNum: number;
  title: string;
  shortTitle: string;
  icon: React.ReactNode;
  likelihoodRatio: number;
  runningProbability: number;
  explanation: string;
  findingIds: string[];
}

export function RiskChain({ proposalId, risk, findings = [] }: RiskChainProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Standard scenario presets matching Meridian problem statement
  const defaultScenarios: Record<
    string,
    {
      prior: number;
      stages: StageDetail[];
      posterior: number;
      level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      action: "none" | "review" | "halt";
    }
  > = {
    "MIP-21": {
      prior: 0.05,
      stages: [
        {
          id: "claims",
          stageNum: 1,
          title: "Proposal Claims",
          shortTitle: "Claims",
          icon: <FileText className="h-4 w-4 text-amber-400" />,
          likelihoodRatio: 4.5,
          runningProbability: 0.191,
          explanation: "Storage layout optimization claims contradict byte-packed vault implementation.",
          findingIds: ["fnd-1"],
        },
        {
          id: "coi",
          stageNum: 2,
          title: "Conflict of Interest Risk",
          shortTitle: "COI",
          icon: <Users className="h-4 w-4 text-rose-400" />,
          likelihoodRatio: 3.8,
          runningProbability: 0.474,
          explanation: "Undisclosed funding trace to unverified recipient wallet #14 (pLink: 95%).",
          findingIds: ["fnd-coi-1"],
        },
        {
          id: "voting",
          stageNum: 3,
          title: "On-Chain Voting",
          shortTitle: "Voting",
          icon: <Vote className="h-4 w-4 text-purple-400" />,
          likelihoodRatio: 2.5,
          runningProbability: 0.692,
          explanation: "Delegate requested layout diff; proposer deflected before vote passed.",
          findingIds: ["fnd-vote-1"],
        },
        {
          id: "execution",
          stageNum: 4,
          title: "Execution Discrepancy",
          shortTitle: "Execution",
          icon: <Terminal className="h-4 w-4 text-red-500" />,
          likelihoodRatio: 45.0,
          runningProbability: 0.99,
          explanation: "Simulation detected unauthorized ownership takeover and unlimited USDC drain.",
          findingIds: ["fnd-2", "fnd-3"],
        },
      ],
      posterior: 0.99,
      level: "CRITICAL",
      action: "halt",
    },
    "MIP-17": {
      prior: 0.05,
      stages: [
        {
          id: "claims",
          stageNum: 1,
          title: "Proposal Claims",
          shortTitle: "Claims",
          icon: <FileText className="h-4 w-4 text-amber-400" />,
          likelihoodRatio: 4.0,
          runningProbability: 0.174,
          explanation: "$1.5M budget discrepancy between summary request and itemized workstreams.",
          findingIds: ["fnd-17-1"],
        },
        {
          id: "coi",
          stageNum: 2,
          title: "Conflict of Interest Risk",
          shortTitle: "COI",
          icon: <Users className="h-4 w-4 text-orange-400" />,
          likelihoodRatio: 5.2,
          runningProbability: 0.523,
          explanation: "Nexus Labs wallet received prior stealth funding from proposer address.",
          findingIds: ["fnd-17-2"],
        },
        {
          id: "voting",
          stageNum: 3,
          title: "On-Chain Voting",
          shortTitle: "Voting",
          icon: <Vote className="h-4 w-4 text-amber-400" />,
          likelihoodRatio: 3.5,
          runningProbability: 0.793,
          explanation: "High delegate dissent; quorum reached via concentrated whale voting weight.",
          findingIds: ["fnd-17-3"],
        },
        {
          id: "execution",
          stageNum: 4,
          title: "Execution Discrepancy",
          shortTitle: "Execution",
          icon: <Terminal className="h-4 w-4 text-orange-500" />,
          likelihoodRatio: 1.8,
          runningProbability: 0.873,
          explanation: "Immediate full-sum treasury release without milestone escrow timelock.",
          findingIds: ["fnd-17-4"],
        },
      ],
      posterior: 0.88,
      level: "HIGH",
      action: "halt",
    },
    "MIP-12": {
      prior: 0.05,
      stages: [
        {
          id: "claims",
          stageNum: 1,
          title: "Proposal Claims",
          shortTitle: "Claims",
          icon: <FileText className="h-4 w-4 text-emerald-400" />,
          likelihoodRatio: 0.4,
          runningProbability: 0.021,
          explanation: "100% of requested deliverables and timeline milestones backed by verified citations.",
          findingIds: [],
        },
        {
          id: "coi",
          stageNum: 2,
          title: "Conflict of Interest Risk",
          shortTitle: "COI",
          icon: <Users className="h-4 w-4 text-emerald-400" />,
          likelihoodRatio: 0.5,
          runningProbability: 0.01,
          explanation: "Zero undisclosed links found; valid EIP-191 disclosure signature.",
          findingIds: [],
        },
        {
          id: "voting",
          stageNum: 3,
          title: "On-Chain Voting",
          shortTitle: "Voting",
          icon: <Vote className="h-4 w-4 text-emerald-400" />,
          likelihoodRatio: 0.6,
          runningProbability: 0.006,
          explanation: "Broad decentralized delegate consensus with zero sybil clustering.",
          findingIds: [],
        },
        {
          id: "execution",
          stageNum: 4,
          title: "Execution Discrepancy",
          shortTitle: "Execution",
          icon: <Terminal className="h-4 w-4 text-emerald-400" />,
          likelihoodRatio: 0.3,
          runningProbability: 0.002,
          explanation: "Calldata exactly matches 400,000 USDC transfer to audited dev escrow.",
          findingIds: [],
        },
      ],
      posterior: 0.02,
      level: "LOW",
      action: "none",
    },
  };

  const currentPreset = defaultScenarios[proposalId] || defaultScenarios["MIP-21"];

  // Merge any dynamic risk data if provided
  const riskData = useMemo(() => {
    const prior = risk?.prior ?? currentPreset.prior;
    const priorOdds = prior / (1 - prior);

    let runningOdds = priorOdds;
    const stages: StageDetail[] = currentPreset.stages.map((stg) => {
      const match = risk?.stages?.find((s) => s.stage === stg.id);
      const lr = match?.likelihoodRatio ?? stg.likelihoodRatio;
      runningOdds = runningOdds * lr;
      const calcProb = runningOdds / (1 + runningOdds);

      return {
        ...stg,
        likelihoodRatio: lr,
        runningProbability: match?.probability ?? calcProb,
        explanation: match?.explanation || stg.explanation,
        findingIds: match?.findingIds && match.findingIds.length > 0 ? match.findingIds : stg.findingIds,
      };
    });

    const posterior = risk?.posterior ?? stages[stages.length - 1].runningProbability;
    const level = risk?.level ?? currentPreset.level;
    const action = risk?.action ?? currentPreset.action;

    return { prior, stages, posterior, level, action };
  }, [risk, currentPreset]);

  // Chart data points: Prior -> Stage 1 -> Stage 2 -> Stage 3 -> Stage 4
  const chartData = useMemo(() => {
    return [
      {
        name: "Prior",
        label: "5% Prior",
        probability: Number((riskData.prior * 100).toFixed(1)),
        stageName: "Baseline Prior",
        lr: "1.0x",
      },
      ...riskData.stages.map((s) => ({
        name: s.shortTitle,
        label: s.title,
        probability: Number((s.runningProbability * 100).toFixed(1)),
        stageName: s.title,
        lr: `${s.likelihoodRatio.toFixed(1)}x`,
      })),
    ];
  }, [riskData]);

  // Handle finding click
  const handleFindingClick = (findingId: string) => {
    const found = findings.find((f) => f.id === findingId) || {
      id: findingId,
      severity: findingId.includes("2") || findingId.includes("3") ? "critical" : "high",
      category: findingId.includes("coi")
        ? "coi"
        : findingId.includes("2")
        ? "ownership_change"
        : findingId.includes("3")
        ? "unlimited_approval"
        : "undeclared_action",
      said: "The proposal promised gas optimizations and routine protocol improvements with no unauthorized state mutations.",
      does: "Submitted transaction executes privileged ownership transfer and approves unrestricted asset draining.",
      evidence: [],
    };
    setSelectedFinding(found as Finding);
    setDialogOpen(true);
  };

  // Styling helpers
  const getLevelBadge = (level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL") => {
    switch (level) {
      case "CRITICAL":
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/40 text-xs font-bold px-2.5 py-0.5">CRITICAL</Badge>;
      case "HIGH":
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/40 text-xs font-bold px-2.5 py-0.5">HIGH</Badge>;
      case "MEDIUM":
        return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-xs font-bold px-2.5 py-0.5">MEDIUM</Badge>;
      case "LOW":
      default:
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs font-bold px-2.5 py-0.5">LOW</Badge>;
    }
  };

  const getActionBadge = (action: "none" | "review" | "halt") => {
    switch (action) {
      case "halt":
        return (
          <div className="flex items-center gap-2 bg-red-950/60 border border-red-500/40 px-3 py-1.5 rounded-lg text-red-300 font-mono text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 text-red-400 animate-pulse" />
            <span>ACTION: HALT</span>
          </div>
        );
      case "review":
        return (
          <div className="flex items-center gap-2 bg-amber-950/60 border border-amber-500/40 px-3 py-1.5 rounded-lg text-amber-300 font-mono text-xs font-semibold">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>ACTION: REVIEW</span>
          </div>
        );
      case "none":
      default:
        return (
          <div className="flex items-center gap-2 bg-emerald-950/60 border border-emerald-500/40 px-3 py-1.5 rounded-lg text-emerald-300 font-mono text-xs font-semibold">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>ACTION: NONE</span>
          </div>
        );
    }
  };

  const getStageBorder = (prob: number, lr: number) => {
    if (prob > 0.75 || lr >= 5.0) return "border-red-500/40 bg-red-950/15";
    if (prob > 0.35 || lr >= 2.0) return "border-amber-500/30 bg-amber-950/10";
    return "border-emerald-500/30 bg-emerald-950/10";
  };

  const getLrColor = (lr: number) => {
    if (lr >= 4.0) return "text-red-400 bg-red-500/10 border-red-500/30";
    if (lr > 1.0) return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Chain Overview */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <CardTitle className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <span>Bayesian Risk Propagation Chain</span>
                  <Badge variant="outline" className="text-[10px] font-mono text-slate-400">
                    {proposalId}
                  </Badge>
                </CardTitle>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Sequential Bayesian update tracking adversarial probability across the problem statement&apos;s 4 verification stages.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="text-right mr-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Posterior</span>
                <span className="font-mono font-bold text-sm text-slate-100">
                  {(riskData.posterior * 100).toFixed(1)}%
                </span>
              </div>
              {getLevelBadge(riskData.level)}
              {getActionBadge(riskData.action)}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-1 pb-5">
          {/* 4 Connected Stage Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative">
            {riskData.stages.map((stage, idx) => {
              const probPercent = (stage.runningProbability * 100).toFixed(1);
              const isLast = idx === riskData.stages.length - 1;

              return (
                <div
                  key={stage.id}
                  className={`p-4 rounded-xl border flex flex-col justify-between transition-all duration-200 relative ${getStageBorder(
                    stage.runningProbability,
                    stage.likelihoodRatio
                  )}`}
                >
                  <div>
                    {/* Header: Stage index and LR badge */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs font-mono text-slate-400">
                        {stage.icon}
                        <span>Stage {stage.stageNum}</span>
                      </div>
                      <span
                        className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${getLrColor(
                          stage.likelihoodRatio
                        )}`}
                      >
                        LR: {stage.likelihoodRatio.toFixed(1)}x
                      </span>
                    </div>

                    {/* Stage Title */}
                    <h4 className="text-sm font-semibold text-white mb-2">{stage.title}</h4>

                    {/* Running Probability Metric */}
                    <div className="mb-3 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-[11px] text-slate-400">Running Probability</span>
                        <span
                          className={`text-base font-mono font-bold ${
                            stage.runningProbability > 0.75
                              ? "text-red-400"
                              : stage.runningProbability > 0.35
                              ? "text-amber-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {probPercent}%
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            stage.runningProbability > 0.75
                              ? "bg-red-500"
                              : stage.runningProbability > 0.35
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(2, stage.runningProbability * 100))}%` }}
                        />
                      </div>
                    </div>

                    {/* One-line explanation */}
                    <p className="text-xs text-slate-300 leading-relaxed mb-3 min-h-[36px]">
                      {stage.explanation}
                    </p>
                  </div>

                  {/* Findings links */}
                  <div className="pt-3 border-t border-slate-800/80 mt-auto">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-400">Findings:</span>
                      {stage.findingIds.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {stage.findingIds.map((fId) => (
                            <button
                              key={fId}
                              onClick={() => handleFindingClick(fId)}
                              className="inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 hover:border-sky-500/50 transition-colors"
                              title={`View finding details for ${fId}`}
                            >
                              <span>{fId}</span>
                              <ExternalLink className="w-2.5 h-2.5" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-emerald-400/80 font-mono">None (Clean)</span>
                      )}
                    </div>
                  </div>

                  {/* Desktop connector arrow */}
                  {!isLast && (
                    <div className="hidden lg:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-slate-400 shadow-md">
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Bottom Row: Recharts Line Chart & Final Verdict Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Recharts Line Chart (8 cols) */}
        <Card className="lg:col-span-8 border-slate-800 bg-slate-900/60 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-400" />
                <span>Bayesian Probability Trajectory (5% Prior → Posterior)</span>
              </CardTitle>
              <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Halt (&gt;80%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Review (&gt;50%)
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-[210px] w-full">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 12, right: 24, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="name"
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: "#334155" }}
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#64748b"
                      fontSize={11}
                      tickFormatter={(v) => `${v}%`}
                      tickLine={false}
                      axisLine={{ stroke: "#334155" }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-slate-950/95 border border-slate-800 rounded-lg p-2.5 shadow-xl text-xs space-y-1">
                              <p className="font-semibold text-slate-200">{data.stageName}</p>
                              <div className="flex justify-between gap-4 font-mono text-[11px]">
                                <span className="text-slate-400">Likelihood Ratio:</span>
                                <span className="text-sky-400 font-bold">{data.lr}</span>
                              </div>
                              <div className="flex justify-between gap-4 font-mono text-[11px]">
                                <span className="text-slate-400">Running Prob:</span>
                                <span className="text-amber-400 font-bold">{data.probability}%</span>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.6} />
                    <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.4} />
                    <Line
                      type="monotone"
                      dataKey="probability"
                      stroke={
                        riskData.level === "CRITICAL"
                          ? "#ef4444"
                          : riskData.level === "HIGH"
                          ? "#f97316"
                          : riskData.level === "MEDIUM"
                          ? "#f59e0b"
                          : "#10b981"
                      }
                      strokeWidth={3}
                      dot={{ r: 5, fill: "#0f172a", strokeWidth: 2 }}
                      activeDot={{ r: 7 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-slate-500">
                  Loading Bayesian trajectory chart...
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Final Level & Action Verdict Card (4 cols) */}
        <Card className="lg:col-span-4 border-slate-800 bg-slate-900/60 backdrop-blur-sm flex flex-col justify-between">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center justify-between">
              <span>Final Risk Assessment</span>
              {getLevelBadge(riskData.level)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-1 pb-4">
            {/* Level Banner */}
            <div className="bg-slate-950/70 border border-slate-800/80 p-3 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Calculated Level</span>
                <span className="font-bold text-slate-200">{riskData.level}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Recommended Action</span>
                <span className="font-mono font-bold uppercase text-slate-200">{riskData.action}</span>
              </div>
              <div className="pt-1">{getActionBadge(riskData.action)}</div>
            </div>

            {/* Action explanation */}
            <div className="text-xs text-slate-400 leading-relaxed bg-slate-900/80 p-2.5 rounded-lg border border-slate-800/80">
              {riskData.action === "halt" && (
                <p>
                  <strong className="text-red-400">Autonomous Timelock Halt:</strong> High posterior anomaly probability triggers automatic cancel proposal in timelock queue.
                </p>
              )}
              {riskData.action === "review" && (
                <p>
                  <strong className="text-amber-400">Manual Review Required:</strong> Escalated to DAO security council for secondary inspection before execution.
                </p>
              )}
              {riskData.action === "none" && (
                <p>
                  <strong className="text-emerald-400">Timelock Safe:</strong> Zero critical discrepancies found. Transaction permitted to proceed normally.
                </p>
              )}
            </div>

            {/* Odds Progression Summary */}
            <div className="grid grid-cols-3 gap-1 pt-1 text-center font-mono">
              <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">PRIOR</span>
                <span className="text-xs font-bold text-slate-300">5.0%</span>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">TOTAL LR</span>
                <span className="text-xs font-bold text-sky-400">
                  {riskData.stages.reduce((acc, s) => acc * s.likelihoodRatio, 1).toFixed(0)}x
                </span>
              </div>
              <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800">
                <span className="text-[10px] text-slate-500 block">POSTERIOR</span>
                <span
                  className={`text-xs font-bold ${
                    riskData.posterior > 0.8 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {(riskData.posterior * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Finding Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg bg-slate-900 border-slate-800 text-slate-100">
          <DialogHeader>
            <div className="flex items-center justify-between pr-4">
              <DialogTitle className="text-base font-semibold font-mono flex items-center gap-2">
                <span>{selectedFinding?.id}</span>
                <Badge variant="outline" className="text-[10px] uppercase font-sans">
                  {selectedFinding?.category}
                </Badge>
              </DialogTitle>
              <Badge
                className={`text-xs font-bold ${
                  selectedFinding?.severity === "critical"
                    ? "bg-red-500/20 text-red-400 border-red-500/40"
                    : selectedFinding?.severity === "high"
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                    : "bg-amber-500/20 text-amber-400 border-amber-500/40"
                }`}
              >
                {selectedFinding?.severity}
              </Badge>
            </div>
            <DialogDescription className="text-xs text-slate-400">
              Evidence item linked to Bayesian likelihood ratio calculation
            </DialogDescription>
          </DialogHeader>

          {selectedFinding && (
            <div className="space-y-3 pt-2 text-xs">
              <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                  What Proposal Claimed
                </span>
                <p className="text-slate-300 italic">&ldquo;{selectedFinding.said}&rdquo;</p>
              </div>

              <div className="bg-red-950/20 p-3 rounded-lg border border-red-500/30 space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-red-400 font-semibold block">
                  What Code / Calldata Does
                </span>
                <p className="text-red-200">{selectedFinding.does}</p>
              </div>

              {selectedFinding.evidence && selectedFinding.evidence.length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] uppercase text-slate-400 font-semibold block mb-1">
                    Citations ({selectedFinding.evidence.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFinding.evidence.map((cit, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700"
                      >
                        {cit.chunkId} ({cit.sourceUri || "doc"})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
