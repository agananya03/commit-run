"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Users, Vote, Terminal, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface RiskChainProps {
  proposalId: string;
}

export function RiskChain({ proposalId }: RiskChainProps) {
  // Scenario-specific risk chain states based on Meridian specifications
  const scenarios: Record<
    string,
    {
      claims: { status: "pass" | "warn" | "fail"; label: string; detail: string; score: number };
      coi: { status: "pass" | "warn" | "fail"; label: string; detail: string; score: number };
      voting: { status: "pass" | "warn" | "fail"; label: string; detail: string; score: number };
      execution: { status: "pass" | "warn" | "fail"; label: string; detail: string; score: number };
      verdict: "APPROVED" | "FLAGGED";
    }
  > = {
    "MIP-12": {
      claims: { status: "pass", label: "Claims Verified", detail: "100% exact citation support", score: 0.94 },
      coi: { status: "pass", label: "Zero COI", detail: "No undisclosed wallet links", score: 0.98 },
      voting: { status: "pass", label: "Delegate Consensus", detail: "5 of 6 delegates approved", score: 0.91 },
      execution: { status: "pass", label: "Calldata Aligned", detail: "Parameters match text", score: 0.99 },
      verdict: "APPROVED",
    },
    "MIP-17": {
      claims: { status: "warn", label: "Unverified Claims", detail: "Grant spend lacks milestone lock", score: 0.62 },
      coi: { status: "fail", label: "Conflict Detected", detail: "Nexus Labs linked to proposer wallet", score: 0.28 },
      voting: { status: "warn", label: "Divided Delegates", detail: "delegator_alpha questioned 5% spend", score: 0.55 },
      execution: { status: "pass", label: "Calldata Direct", detail: "Direct transfer of 2.5M USDC", score: 0.85 },
      verdict: "FLAGGED",
    },
    "MIP-21": {
      claims: { status: "fail", label: "Contradicted Intent", detail: "Promised 0 ownership changes", score: 0.21 },
      coi: { status: "fail", label: "Secret Beneficiary", detail: "Unexplained wallet 0xdF3e...7097", score: 0.15 },
      voting: { status: "fail", label: "Deceptive Voting", detail: "Delegate asked for diff; denied", score: 0.32 },
      execution: { status: "fail", label: "Trojan Backdoor", detail: "Unlimited approval + vault transfer", score: 0.05 },
      verdict: "FLAGGED",
    },
  };

  const current = scenarios[proposalId] || scenarios["MIP-21"];

  const stages = [
    {
      num: 1,
      title: "Stage 1: Intent & Claims",
      icon: <FileText className="h-5 w-5 text-indigo-400" />,
      ...current.claims,
    },
    {
      num: 2,
      title: "Stage 2: Conflict of Interest",
      icon: <Users className="h-5 w-5 text-purple-400" />,
      ...current.coi,
    },
    {
      num: 3,
      title: "Stage 3: Delegate Voting",
      icon: <Vote className="h-5 w-5 text-sky-400" />,
      ...current.voting,
    },
    {
      num: 4,
      title: "Stage 4: On-Chain Execution",
      icon: <Terminal className="h-5 w-5 text-rose-400" />,
      ...current.execution,
    },
  ];

  return (
    <Card className="border-slate-800 bg-slate-900/40">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center space-x-2">
            <span>4-Stage Probabilistic Risk Chain</span>
            <Badge variant="outline" className="text-xs">
              Bayesian Audit Trail
            </Badge>
          </CardTitle>
          <Badge
            variant={current.verdict === "FLAGGED" ? "destructive" : "success"}
            className="text-xs font-bold"
          >
            VERDICT: {current.verdict}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {stages.map((stage) => {
            const statusIcons = {
              pass: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
              warn: <AlertTriangle className="h-4 w-4 text-amber-400" />,
              fail: <XCircle className="h-4 w-4 text-rose-400" />,
            };

            const borderColors = {
              pass: "border-emerald-500/30 bg-emerald-950/10",
              warn: "border-amber-500/30 bg-amber-950/10",
              fail: "border-rose-500/30 bg-rose-950/10",
            };

            return (
              <div
                key={stage.num}
                className={`p-4 rounded-xl border ${borderColors[stage.status]} flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono text-slate-400">
                      {stage.title}
                    </span>
                    {statusIcons[stage.status]}
                  </div>
                  <h4 className="text-sm font-semibold text-white mb-1">
                    {stage.label}
                  </h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {stage.detail}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Confidence</span>
                  <span className="font-mono font-bold text-white">
                    {(stage.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
