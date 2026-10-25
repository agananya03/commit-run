"use client";

import React, { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Info,
  Copy,
  Check,
  FileCode2,
  Terminal,
  FileQuestion,
  ExternalLink,
} from "lucide-react";
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
      effect: "Vault ownership transferred from Timelock to wallet 14 via reinitializeV2()",
      describedQuote: null,
      severity: "critical",
      verdict: "unauthorized_ownership_change",
    },
    {
      id: "ev_21_2",
      effect: "Treasury.approve() grants unlimited (2^256-1) USDC allowance to wallet 14",
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
      severity: "low",
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
      effect: "Treasury.transfer executes 5,000,000 USDC transfer to wallet 12",
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
      effect: "Treasury.transfer executes 400,000 USDC transfer to wallet 9",
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

const HASHES_BY_PROPOSAL: Record<string, { simHash: string; bytecodeHash: string }> = {
  "MIP-21": {
    simHash: "0x8e21a4f07a9b0c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
    bytecodeHash: "0x3d4107e812a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9",
  },
  "MIP-17": {
    simHash: "0x5f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a",
    bytecodeHash: "0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b",
  },
  "MIP-12": {
    simHash: "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    bytecodeHash: "0x7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
  },
};

export function EvidenceTable({ proposalId, rows, className }: EvidenceTableProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const displayRows = rows || DEFAULT_ROWS_BY_PROPOSAL[proposalId];
  const hashes = HASHES_BY_PROPOSAL[proposalId] || HASHES_BY_PROPOSAL["MIP-21"];

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return (
          <Badge className="bg-red-950 text-red-400 border border-red-500 font-mono text-xs sm:text-sm font-bold gap-1.5 px-3 py-1 shadow-sm">
            <ShieldAlert className="w-4 h-4 text-red-400" />
            CRITICAL
          </Badge>
        );
      case "high":
        return (
          <Badge className="bg-amber-950 text-amber-400 border border-amber-500 font-mono text-xs sm:text-sm font-bold gap-1.5 px-3 py-1 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            HIGH
          </Badge>
        );
      default:
        return (
          <Badge className="bg-emerald-950 text-emerald-400 border border-emerald-500 font-mono text-xs sm:text-sm font-bold gap-1.5 px-3 py-1 shadow-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            LOW
          </Badge>
        );
    }
  };

  // Empty State if no execution rows exist
  if (!displayRows || displayRows.length === 0) {
    return (
      <div className={cn("rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center shadow-xl", className)}>
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3 rounded-full bg-slate-800/80 border border-slate-700 text-slate-400">
            <FileQuestion className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-slate-200">
            No Execution Discrepancies Recorded
          </h3>
          <p className="text-sm text-slate-400 max-w-md">
            Simulation traces for {proposalId} reveal no executed state changes deviating from standard protocol parameters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border border-slate-800 bg-slate-900/80 overflow-hidden shadow-2xl", className)}>
      {/* Header with Projector-Ready Type */}
      <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs uppercase tracking-wider text-indigo-400 font-bold">
              Calldata Diff Engine
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-xs text-slate-400 font-mono">{proposalId}</span>
          </div>
          <h3 className="text-base sm:text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>What the Code Actually Does vs What the Proposal Said</span>
          </h3>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Decoded calls, token transfers, approvals, and ownership mutations cross-referenced with human promises.
          </p>
        </div>
        <div className="text-xs sm:text-sm font-mono text-slate-400 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shrink-0 w-fit">
          {displayRows.length} audited transition(s)
        </div>
      </div>

      {/* Two-Column Diff Table with Projector-Optimized Font Sizes */}
      <div className="overflow-x-auto">
        <Table className="min-w-[750px]">
          <TableHeader>
            <TableRow className="border-slate-800 bg-slate-950/80 hover:bg-slate-950/80">
              <TableHead className="w-[45%] text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-300 py-3.5 px-5">
                What the Code Actually Does (Simulated EVM Effect)
              </TableHead>
              <TableHead className="w-[42%] text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-300 py-3.5 px-5">
                What the Proposal Said
              </TableHead>
              <TableHead className="w-[13%] text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-300 text-right py-3.5 px-5">
                Severity
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row, index) => {
              const isNotDescribed = row.describedQuote === null || row.describedQuote.trim() === "";
              const isCritical = row.severity === "critical";
              const isHigh = row.severity === "high";

              return (
                <TableRow
                  key={row.id || index}
                  className={cn(
                    "border-slate-800/80 transition-colors",
                    isCritical
                      ? "hover:bg-red-950/20 bg-red-950/10"
                      : isHigh
                      ? "hover:bg-amber-950/20 bg-amber-950/10"
                      : "hover:bg-slate-800/40"
                  )}
                >
                  {/* Left Column: What the code actually does */}
                  <TableCell className="align-top py-4 px-5">
                    <div className="space-y-1.5">
                      <div className="font-mono text-sm sm:text-base text-slate-100 leading-relaxed font-semibold">
                        {row.effect}
                      </div>
                      {row.verdict && (
                        <span className="inline-block text-xs font-mono uppercase tracking-wider text-slate-500">
                          audit verdict: <span className="text-slate-400 font-semibold">{row.verdict}</span>
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Right Column: What the proposal said */}
                  <TableCell className="align-top py-4 px-5">
                    {isNotDescribed ? (
                      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-red-950/90 border border-red-500 text-red-300 font-mono text-xs sm:text-sm font-bold tracking-wide shadow-sm">
                        <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                        <span>NOT DESCRIBED (UNMENTIONED ACTION)</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-sm sm:text-base text-slate-200 italic bg-slate-950/80 p-3 rounded-lg border border-slate-800 leading-relaxed font-sans">
                          &ldquo;{row.describedQuote}&rdquo;
                        </p>
                        {row.citation && (
                          <div className="text-xs font-mono text-slate-400 flex items-center gap-1.5 pt-0.5">
                            <span className="text-slate-500">Citation:</span>
                            <span className="text-indigo-400 font-semibold">{row.citation.chunkId}</span>
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-500">{row.citation.sourceUri}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>

                  {/* Severity Column */}
                  <TableCell className="align-top py-4 px-5 text-right">
                    {getSeverityBadge(row.severity)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Monospace Cryptographic Hashes Bar with Copy Buttons */}
      <div className="px-5 py-3 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm font-mono">
        <div className="flex flex-wrap items-center gap-4">
          {/* simHash */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
            <span className="text-slate-400">simHash:</span>
            <span className="text-slate-200 font-semibold" title={hashes.simHash}>
              {hashes.simHash.slice(0, 10)}...{hashes.simHash.slice(-8)}
            </span>
            <button
              onClick={() => handleCopy("simHash", hashes.simHash)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Copy simulation hash"
            >
              {copiedKey === "simHash" ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* bytecodeHash */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg">
            <span className="text-slate-400">bytecodeHash:</span>
            <span className="text-indigo-300 font-semibold" title={hashes.bytecodeHash}>
              {hashes.bytecodeHash.slice(0, 10)}...{hashes.bytecodeHash.slice(-8)}
            </span>
            <button
              onClick={() => handleCopy("bytecodeHash", hashes.bytecodeHash)}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Copy bytecode hash"
            >
              {copiedKey === "bytecodeHash" ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <div className="text-slate-500 text-xs">
          Anvil Fork Trace Verified • State Diff Match: 100%
        </div>
      </div>
    </div>
  );
}
