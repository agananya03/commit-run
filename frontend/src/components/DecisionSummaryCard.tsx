"use client";

import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatUSD } from "@/lib/utils";
import { DecisionSummary, Citation } from "@/lib/api";
import { Coins, AlertTriangle, Link2, CheckCircle2, Quote, ExternalLink } from "lucide-react";

interface DecisionSummaryCardProps {
  summary: DecisionSummary | null;
  isLoading: boolean;
}

export function DecisionSummaryCard({ summary, isLoading }: DecisionSummaryCardProps) {
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

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

  return (
    <>
      <Card className="border-slate-800 bg-slate-900/60 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-bold text-white flex items-center space-x-2">
              <span>Decision Summary</span>
              <Badge variant="default" className="text-xs">
                Proposal {summary.proposalId}
              </Badge>
            </CardTitle>
          </div>
          <p className="text-sm text-slate-300 mt-2 bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-lg leading-relaxed">
            <span className="font-semibold text-indigo-400 mr-2">TL;DR:</span>
            {summary.tldr}
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Treasury Impact */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/40">
            <div className="flex items-center space-x-2 mb-3">
              <Coins className="h-5 w-5 text-amber-400" />
              <h4 className="text-sm font-semibold text-white">Treasury Impact</h4>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-slate-400">Requested Amount</p>
                <p className="text-base font-bold text-white mt-0.5">
                  {summary.treasuryImpact.amountUsd !== null
                    ? formatUSD(summary.treasuryImpact.amountUsd)
                    : "No funds requested (0 USDC)"}
                </p>
              </div>

              <div>
                <p className="text-slate-400">% of 20M Treasury</p>
                <p className="text-base font-bold text-indigo-300 mt-0.5">
                  {summary.treasuryImpact.pctOfTreasury !== null
                    ? `${summary.treasuryImpact.pctOfTreasury}%`
                    : "0.0%"}
                </p>
              </div>

              <div>
                <p className="text-slate-400">Recipients</p>
                <p className="text-xs font-mono text-slate-200 mt-1 truncate">
                  {summary.treasuryImpact.recipients.length > 0
                    ? summary.treasuryImpact.recipients.join(", ")
                    : "None"}
                </p>
              </div>
            </div>

            {summary.treasuryImpact.citations.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-800/60 flex flex-wrap gap-2">
                <span className="text-[11px] text-slate-400">Treasury Citations:</span>
                {summary.treasuryImpact.citations.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedCitation(c)}
                    className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] hover:bg-indigo-500/20"
                  >
                    <Quote className="h-3 w-3" />
                    <span>{c.chunkId}</span>
                  </button>
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
              <ul className="space-y-2.5 text-xs">
                {summary.risks.map((risk, idx) => (
                  <li key={idx} className="flex flex-col space-y-1">
                    <span className="text-slate-200">• {risk.text}</span>
                    {risk.citations.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 ml-3">
                        {risk.citations.map((c, ci) => (
                          <button
                            key={ci}
                            onClick={() => setSelectedCitation(c)}
                            className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] hover:bg-rose-500/20"
                          >
                            <span>{c.chunkId}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {/* Dependencies */}
            <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-950/10">
              <div className="flex items-center space-x-2 mb-3">
                <Link2 className="h-4 w-4 text-purple-400" />
                <h4 className="text-sm font-semibold text-purple-300">
                  Dependencies ({summary.dependencies.length})
                </h4>
              </div>
              <ul className="space-y-2.5 text-xs">
                {summary.dependencies.map((dep, idx) => (
                  <li key={idx} className="flex flex-col space-y-1">
                    <span className="text-slate-200">• {dep.text}</span>
                    {dep.citations.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 ml-3">
                        {dep.citations.map((c, ci) => (
                          <button
                            key={ci}
                            onClick={() => setSelectedCitation(c)}
                            className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] hover:bg-purple-500/20"
                          >
                            <span>{c.chunkId}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Claims Table with Citations */}
          <div>
            <h4 className="text-sm font-semibold text-white mb-3 flex items-center space-x-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span>Extracted Claims & Citations ({summary.claims.length})</span>
            </h4>
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-400">
                  <tr>
                    <th className="p-3">Claim</th>
                    <th className="p-3">Kind</th>
                    <th className="p-3">Support</th>
                    <th className="p-3">p(Supported)</th>
                    <th className="p-3">Citations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {summary.claims.map((claim) => (
                    <tr key={claim.id} className="hover:bg-slate-800/30">
                      <td className="p-3 text-slate-200 max-w-xs">{claim.text}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {claim.kind}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={
                            claim.support === "supported"
                              ? "success"
                              : claim.support === "contradicted"
                              ? "destructive"
                              : "warning"
                          }
                          className="text-[10px] uppercase"
                        >
                          {claim.support}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono font-bold text-slate-300">
                        {(claim.pSupported * 100).toFixed(0)}%
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          {claim.citations.map((c, ci) => (
                            <button
                              key={ci}
                              onClick={() => setSelectedCitation(c)}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-400 text-[10px] border border-slate-700 font-mono"
                            >
                              {c.chunkId}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Citation Inspector Modal */}
      <Dialog open={selectedCitation !== null} onOpenChange={(open) => !open && setSelectedCitation(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <Quote className="h-5 w-5 text-indigo-400" />
              <span>Evidence Citation Inspector</span>
            </DialogTitle>
            <DialogDescription>
              Verified cryptographic quote anchored to on-chain evidence hash
            </DialogDescription>
          </DialogHeader>

          {selectedCitation && (
            <div className="space-y-4 text-xs mt-3">
              <div>
                <p className="text-slate-400 mb-1">Verbatim Quote:</p>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 font-serif italic text-sm leading-relaxed">
                  &ldquo;{selectedCitation.quote}&rdquo;
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800">
                <div>
                  <p className="text-slate-400">Chunk ID:</p>
                  <p className="font-mono text-indigo-300 font-semibold mt-0.5">
                    {selectedCitation.chunkId}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400">Source URI:</p>
                  <p className="font-mono text-slate-200 mt-0.5 truncate">
                    {selectedCitation.sourceUri}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-slate-400 mb-1">SHA-256 Chunk Hash:</p>
                <p className="font-mono text-[11px] text-emerald-400 bg-slate-950 p-2 rounded border border-slate-800 break-all">
                  {selectedCitation.sha256}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
