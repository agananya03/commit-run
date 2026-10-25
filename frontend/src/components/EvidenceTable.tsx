"use client";

import React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EvidenceRowItem {
  id?: string;
  effect: string;
  describedQuote: string | null;
  severity: "critical" | "high" | "medium" | "low" | "info";
  verdict?: string;
  citation?: {
    chunkId: string;
    sourceUri: string;
  };
}

interface EvidenceTableProps {
  proposalId: string;
  rows?: EvidenceRowItem[];
  className?: string;
}

const DEFAULT_ROWS_BY_PROPOSAL: Record<string, EvidenceRowItem[]> = {
  "MIP-21": [
    {
      id: "ev_21_1",
      effect: "Vault ownership transferred from Timelock to wallet index 14 via reinitializeV2()",
      describedQuote: null,
      severity: "critical",
      verdict: "unauthorized_ownership_change",
    },
    {
      id: "ev_21_2",
      effect: "Treasury.approve() grants unlimited (2^256-1) USDC allowance to wallet index 14",
      describedQuote: null,
      severity: "critical",
      verdict: "unauthorized_approval",
    },
    {
      id: "ev_21_3",
      effect: "Vault implementation upgraded behind UUPS proxy with 2 new privileged selectors (migrateReserves, reinitializeV2)",
      describedQuote: null,
      severity: "critical",
      verdict: "backdoor_methods_injected",
    },
    {
      id: "ev_21_4",
      effect: "EVM storage slot packing: reserveCap & lastRebalance combined in Slot 3 (SLOAD reduction)",
      describedQuote: "deposit(uint256) falls from 48,712 to 48,390 gas and withdraw(uint256) from 53,104 to 52,877 gas.",
      severity: "info",
      verdict: "verified_technical_optimization",
      citation: {
        chunkId: "MIP-21:pdf:1",
        sourceUri: "pdf://MIP-21/proposal.pdf#page=4",
      },
    },
  ],
  "MIP-17": [
    {
      id: "ev_17_1",
      effect: "Treasury.transfer executes 5,000,000 USDC transfer to wallet index 12",
      describedQuote: "Total Itemized Budget Allocation: $3,500,000 USDC",
      severity: "critical",
      verdict: "budget_discrepancy_surplus",
      citation: {
        chunkId: "MIP-17:pdf:1",
        sourceUri: "pdf://MIP-17/proposal.pdf#page=2",
      },
    },
    {
      id: "ev_17_2",
      effect: "Prior off-chain/on-chain seed funding trail from proposer wallet 10 through 11 to recipient 12",
      describedQuote: null,
      severity: "high",
      verdict: "undisclosed_conflict_of_interest",
    },
  ],
  "MIP-12": [
    {
      id: "ev_12_1",
      effect: "Treasury.transfer executes 400,000 USDC transfer to wallet index 9",
      describedQuote: "We request a grant of 400,000 USDC from the Meridian Treasury to fund the core SDK and open-source subgraph indexer.",
      severity: "low",
      verdict: "aligned_with_disclosed_terms",
      citation: {
        chunkId: "MIP-12:pdf:0",
        sourceUri: "pdf://MIP-12/proposal.pdf#page=2",
      },
    },
  ],
};

export function EvidenceTable({ proposalId, rows, className }: EvidenceTableProps) {
  const displayRows = rows || DEFAULT_ROWS_BY_PROPOSAL[proposalId] || DEFAULT_ROWS_BY_PROPOSAL["MIP-21"];

  const getSeverityBadge = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return (
          <Badge className="bg-red-950/80 text-red-400 border border-red-500/60 hover:bg-red-900/80 font-mono text-[11px] gap-1 px-2">
            <ShieldAlert className="w-3 h-3 text-red-400" />
            CRITICAL
          </Badge>
        );
      case "high":
        return (
          <Badge className="bg-amber-950/80 text-amber-400 border border-amber-500/60 hover:bg-amber-900/80 font-mono text-[11px] gap-1 px-2">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            HIGH
          </Badge>
        );
      case "medium":
      case "low":
        return (
          <Badge className="bg-slate-800 text-slate-300 border border-slate-700 font-mono text-[11px] gap-1 px-2">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            LOW
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-800 text-slate-400 border border-slate-700 font-mono text-[11px] gap-1 px-2">
            <Info className="w-3 h-3 text-slate-400" />
            INFO
          </Badge>
        );
    }
  };

  return (
    <div className={cn("rounded-lg border border-slate-800 bg-slate-900/80 overflow-hidden shadow-xl", className)}>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-slate-900">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <span>Execution Evidence & Intent Verification</span>
            <span className="text-xs text-slate-400 font-normal">({proposalId})</span>
          </h3>
          <p className="text-xs text-slate-400">
            Automated cross-check comparing simulated state transitions against proposal documentation claims.
          </p>
        </div>
        <div className="text-xs font-mono text-slate-500">
          {displayRows.length} checked effect(s)
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 bg-slate-950/60 hover:bg-slate-950/60">
            <TableHead className="w-[42%] text-xs font-semibold text-slate-300">
              Simulated Effect
            </TableHead>
            <TableHead className="w-[43%] text-xs font-semibold text-slate-300">
              What the Proposal Says
            </TableHead>
            <TableHead className="w-[15%] text-xs font-semibold text-slate-300 text-right">
              Severity
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRows.map((row, index) => {
            const isNotDescribed = row.describedQuote === null || row.describedQuote.trim() === "";

            return (
              <TableRow
                key={row.id || index}
                className={cn(
                  "border-slate-800/80 transition-colors",
                  row.severity === "critical"
                    ? "hover:bg-red-950/20 bg-red-950/10"
                    : row.severity === "high"
                    ? "hover:bg-amber-950/20 bg-amber-950/10"
                    : "hover:bg-slate-800/40"
                )}
              >
                {/* Simulated Effect Column */}
                <TableCell className="align-top py-3.5">
                  <div className="space-y-1">
                    <div className="font-mono text-xs text-slate-200 leading-relaxed font-medium">
                      {row.effect}
                    </div>
                    {row.verdict && (
                      <span className="inline-block text-[10px] font-mono uppercase tracking-wider text-slate-500">
                        audit: {row.verdict}
                      </span>
                    )}
                  </div>
                </TableCell>

                {/* What the Proposal Says Column */}
                <TableCell className="align-top py-3.5">
                  {isNotDescribed ? (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-950/80 border border-red-500/70 text-red-300 font-mono text-xs font-bold tracking-wide">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                      <span>NOT DESCRIBED</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-slate-300 italic bg-slate-950/60 p-2 rounded border border-slate-800 leading-relaxed">
                        &ldquo;{row.describedQuote}&rdquo;
                      </p>
                      {row.citation && (
                        <div className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                          <span>source: {row.citation.chunkId}</span>
                        </div>
                      )}
                    </div>
                  )}
                </TableCell>

                {/* Severity Column */}
                <TableCell className="align-top py-3.5 text-right">
                  {getSeverityBadge(row.severity)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
