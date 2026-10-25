"use client";

import React, { useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatUSD } from "@/lib/utils";
import type { DecisionSummary, Citation as CitationType } from "@/types/shared";
import { Citation } from "@/components/Citation";
import { Coins, AlertTriangle, Link2, CheckCircle2 } from "lucide-react";

interface DecisionSummaryCardProps {
  summary: DecisionSummary | null;
  isLoading: boolean;
}

export function DecisionSummaryCard({ summary, isLoading }: DecisionSummaryCardProps) {
  // Map each citation to a 1-based page index
  const citationMap = useMemo(() => {
    if (!summary) return new Map<CitationType, number>();
    const map = new Map<CitationType, number>();
    let counter = 1;

    // 1. Treasury impact citations
    summary.treasuryImpact.citations.forEach((c) => {
      if (!map.has(c)) {
        map.set(c, counter++);
      }
    });

    // 2. Dependencies citations
    summary.dependencies.forEach((d) => {
      d.citations.forEach((c) => {
        if (!map.has(c)) {
          map.set(c, counter++);
        }
      });
    });

    // 3. Risks citations
    summary.risks.forEach((r) => {
      r.citations.forEach((c) => {
        if (!map.has(c)) {
          map.set(c, counter++);
        }
      });
    });

    // 4. Claims citations
    summary.claims.forEach((cl) => {
      cl.citations.forEach((c) => {
        if (!map.has(c)) {
          map.set(c, counter++);
        }
      });
    });

    return map;
  }, [summary]);

  if (isLoading) {
    return (
      <Card className="border-slate-800 bg-slate-900/50 p-6 animate-pulse">
        <div className="h-6 w-1/3 bg-slate-800 rounded mb-4" />
        <div className="h-4 w-full bg-slate-800 rounded mb-2" />
        <div className="h-4 w-2/3 bg-slate-800 rounded" />
      </Card>
    );
  }

  if (!summary) return null;

  const getSupportBadge = (support: string) => {
    switch (support.toLowerCase()) {
      case "supported":
        return (
          <Badge className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/50 text-[10px] font-mono uppercase px-2 py-0.5">
            SUPPORTED
          </Badge>
        );
      case "contradicted":
        return (
          <Badge className="bg-red-950/80 text-red-400 border border-red-500/50 text-[10px] font-mono uppercase px-2 py-0.5">
            CONTRADICTED
          </Badge>
        );
      case "unsupported":
      default:
        return (
          <Badge className="bg-amber-950/80 text-amber-400 border border-amber-500/50 text-[10px] font-mono uppercase px-2 py-0.5">
            UNSUPPORTED
          </Badge>
        );
    }
  };

  return (
    <Card className="border-slate-800 bg-slate-900/60 shadow-xl">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold text-white flex items-center space-x-2">
            <span>Decision Summary</span>
            <Badge variant="default" className="text-xs font-mono">
              {summary.proposalId}
            </Badge>
          </CardTitle>
        </div>

        {/* TL;DR Section */}
        <div className="mt-2 bg-slate-950/70 border border-slate-800/80 p-3.5 rounded-lg leading-relaxed">
          <span className="font-semibold text-indigo-400 mr-2 text-xs uppercase tracking-wide">TL;DR:</span>
          <span className="text-sm text-slate-200">{summary.tldr}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Treasury Impact */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50">
          <div className="flex items-center space-x-2 mb-3">
            <Coins className="h-5 w-5 text-amber-400" />
            <h4 className="text-sm font-semibold text-white">Treasury Impact</h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
            <div>
              <p className="text-slate-400 text-[11px]">Requested Amount</p>
              <p className="text-base font-bold text-white mt-0.5">
                {summary.treasuryImpact.amountUsd !== null && summary.treasuryImpact.amountUsd !== undefined
                  ? formatUSD(summary.treasuryImpact.amountUsd)
                  : "No funds requested (0 USDC)"}
              </p>
            </div>

            <div>
              <p className="text-slate-400 text-[11px]">% of Treasury (20M USDC)</p>
              <p className="text-base font-bold text-indigo-300 mt-0.5">
                {summary.treasuryImpact.pctOfTreasury !== null && summary.treasuryImpact.pctOfTreasury !== undefined
                  ? `${summary.treasuryImpact.pctOfTreasury}%`
                  : "0.0%"}
              </p>
            </div>

            <div>
              <p className="text-slate-400 text-[11px]">Disclosed Recipients</p>
              <p className="text-xs text-slate-200 mt-1 truncate" title={summary.treasuryImpact.recipients.join(", ")}>
                {summary.treasuryImpact.recipients.length > 0
                  ? summary.treasuryImpact.recipients.join(", ")
                  : "None"}
              </p>
            </div>
          </div>

          {summary.treasuryImpact.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-800/70 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">Citations:</span>
              {summary.treasuryImpact.citations.map((c, i) => (
                <Citation
                  key={i}
                  citation={c}
                  index={citationMap.get(c)}
                  showChunkId={true}
                />
              ))}
            </div>
          )}
        </div>

        {/* Risks & Dependencies Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Risks */}
          <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-950/10">
            <div className="flex items-center space-x-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <h4 className="text-sm font-semibold text-rose-300">
                Identified Risks ({summary.risks.length})
              </h4>
            </div>
            {summary.risks.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No explicit delegate risks flagged.</p>
            ) : (
              <ul className="space-y-2.5 text-xs">
                {summary.risks.map((risk, idx) => (
                  <li key={idx} className="flex flex-col space-y-1">
                    <div className="text-slate-200 flex items-start gap-1.5 leading-relaxed">
                      <span className="text-rose-400 font-bold">•</span>
                      <span>{risk.text}</span>
                      {risk.citations.map((c, ci) => (
                        <Citation
                          key={ci}
                          citation={c}
                          index={citationMap.get(c)}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Dependencies */}
          <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-950/10">
            <div className="flex items-center space-x-2 mb-3">
              <Link2 className="h-4 w-4 text-purple-400" />
              <h4 className="text-sm font-semibold text-purple-300">
                Dependencies ({summary.dependencies.length})
              </h4>
            </div>
            {summary.dependencies.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No external proposal or contract dependencies.</p>
            ) : (
              <ul className="space-y-2.5 text-xs">
                {summary.dependencies.map((dep, idx) => (
                  <li key={idx} className="flex flex-col space-y-1">
                    <div className="text-slate-200 flex items-start gap-1.5 leading-relaxed">
                      <span className="text-purple-400 font-bold">•</span>
                      <span>{dep.text}</span>
                      {dep.citations.map((c, ci) => (
                        <Citation
                          key={ci}
                          citation={c}
                          index={citationMap.get(c)}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Claims Table with Citations */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Extracted Factual Claims ({summary.claims.length})</span>
            </h4>
            <span className="text-[11px] font-mono text-slate-500">
              Independent source NLI verification
            </span>
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/50">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                <tr>
                  <th className="p-3">Claim Sentence</th>
                  <th className="p-3 w-24">Kind</th>
                  <th className="p-3 w-28">NLI Support</th>
                  <th className="p-3 w-24">pSupported</th>
                  <th className="p-3">Citations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {summary.claims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="p-3 text-slate-200 max-w-md leading-relaxed">
                      <span>{claim.text}</span>
                      {claim.citations.length > 0 && (
                        <span className="inline-flex gap-1 ml-1.5 align-middle">
                          {claim.citations.map((c, ci) => (
                            <Citation
                              key={ci}
                              citation={c}
                              index={citationMap.get(c)}
                            />
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      <Badge variant="outline" className="text-[10px] uppercase font-mono border-slate-700 text-slate-300">
                        {claim.kind}
                      </Badge>
                    </td>
                    <td className="p-3 align-top">
                      {getSupportBadge(claim.support)}
                    </td>
                    <td className="p-3 align-top font-mono font-bold text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <span>{(claim.pSupported * 100).toFixed(0)}%</span>
                        <span className="text-[10px] text-slate-500 font-normal">({claim.pSupported})</span>
                      </div>
                    </td>
                    <td className="p-3 align-top">
                      {claim.citations.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {claim.citations.map((c, ci) => (
                            <Citation
                              key={ci}
                              citation={c}
                              index={citationMap.get(c)}
                              showChunkId={true}
                            />
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500 italic">No evidence quote</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
