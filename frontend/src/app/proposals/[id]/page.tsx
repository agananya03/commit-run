"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, Citation as CitationType } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Citation } from "@/components/Citation";
import { EvidenceTable } from "@/components/EvidenceTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  DollarSign,
  Layers,
  FileText,
  Hash,
  ExternalLink,
  ShieldCheck,
  GitBranch,
  Clock,
  Activity,
  AlertCircle,
} from "lucide-react";

const PROPOSAL_METADATA: Record<
  string,
  {
    title: string;
    category: string;
    status: string;
    risk: "CRITICAL" | "HIGH" | "LOW";
    proposer: string;
  }
> = {
  "MIP-21": {
    title: "VaultV2: storage packing and gas optimisation",
    category: "Core Vault Upgrade",
    status: "Voting Active",
    risk: "CRITICAL",
    proposer: "kestrel.eth (walletIndex 13)",
  },
  "MIP-17": {
    title: "Nexus Labs Ecosystem Acceleration & Cross-Chain Liquidity",
    category: "Ecosystem Grant",
    status: "Voting Active",
    risk: "HIGH",
    proposer: "Orion Strategic (walletIndex 10)",
  },
  "MIP-12": {
    title: "Developer SDK and Subgraph Indexer Infrastructure Grant",
    category: "Tooling & Infra",
    status: "Executed",
    risk: "LOW",
    proposer: "Ecosystem Lead (walletIndex 8)",
  },
};

export default function ProposalDetailPage() {
  const params = useParams();
  const proposalId = (params?.id as string) || "MIP-21";

  const meta = PROPOSAL_METADATA[proposalId] || {
    title: `${proposalId} Proposal`,
    category: "Governance Proposal",
    status: "Review",
    risk: "HIGH",
    proposer: "Unknown Proposer",
  };

  // Active citation modal state
  const [selectedCitation, setSelectedCitation] = useState<CitationType | null>(null);

  // Fetch DecisionSummary from mock
  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["decisionSummary", proposalId],
    queryFn: () => api.getDecisionSummary(proposalId),
  });

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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-slate-400 hover:text-indigo-400 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>All Proposals</span>
        </Link>
        <span className="text-slate-600">/</span>
        <span className="font-mono text-slate-200">{proposalId}</span>
      </div>

      {/* Proposal Header Banner */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 backdrop-blur-md shadow-xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl font-bold text-indigo-400">
              {proposalId}
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-xs text-slate-400 font-medium">
              {meta.category}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Badge className="bg-indigo-950/60 text-indigo-300 border border-indigo-700/60 font-mono text-xs">
              {meta.status}
            </Badge>
            {getRiskBadge(meta.risk)}
          </div>
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
          {meta.title}
        </h1>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400 pt-1 border-t border-slate-800/80">
          <div>
            <span className="text-slate-500">Proposer: </span>
            <span className="text-slate-300">{meta.proposer}</span>
          </div>
          <div>
            <span className="text-slate-500">Target: </span>
            <span className="text-slate-300">Meridian DAO Mainnet</span>
          </div>
          <div>
            <span className="text-slate-500">Security Engine: </span>
            <span className="text-indigo-400">ProofOfIntent Bayesian Watchdog</span>
          </div>
        </div>
      </div>

      {/* Tabs Layout */}
      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
          <TabsTrigger value="risk">Risk</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* 1. SUMMARY TAB */}
        <TabsContent value="summary" className="space-y-5">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 font-mono text-xs animate-pulse">
              Loading proposal decision summary from mock...
            </div>
          ) : error || !summary ? (
            <div className="p-6 rounded-lg border border-red-900/60 bg-red-950/20 text-red-300 text-xs font-mono">
              Failed to load decision summary mock for {proposalId}.
            </div>
          ) : (
            <div className="space-y-5">
              {/* TL;DR Executive Card */}
              <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <span>Executive Summary & Intent Overview</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-xs text-slate-300 leading-relaxed">
                  <p className="bg-slate-950/80 p-3 rounded-md border border-slate-800/80 text-slate-200 font-sans text-sm">
                    {summary.tldr}
                  </p>

                  {/* Treasury Impact Sub-section */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 block text-[11px] mb-1">
                        Amount Requested
                      </span>
                      <span className="text-slate-100 font-mono font-bold text-sm">
                        {summary.treasuryImpact.amountUsd !== null
                          ? `$${summary.treasuryImpact.amountUsd.toLocaleString()} USDC`
                          : "$0 (Technical Upgrade)"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 block text-[11px] mb-1">
                        Treasury Share
                      </span>
                      <span className="text-slate-100 font-mono font-bold text-sm">
                        {summary.treasuryImpact.pctOfTreasury !== null
                          ? `${summary.treasuryImpact.pctOfTreasury}% of $20M Liquid Reserves`
                          : "0.0%"}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 block text-[11px] mb-1">
                        Disclosed Recipient(s)
                      </span>
                      <span className="text-slate-100 font-mono text-xs truncate block">
                        {summary.treasuryImpact.recipients.length > 0
                          ? summary.treasuryImpact.recipients[0]
                          : "None Disclosed (Self-contained)"}
                      </span>
                    </div>
                  </div>

                  {summary.treasuryImpact.citations.length > 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-slate-500 text-[11px]">Citations:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {summary.treasuryImpact.citations.map((c, i) => (
                          <Citation
                            key={i}
                            citation={c}
                            onOpen={setSelectedCitation}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Dependencies & Risks Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Dependencies */}
                <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <span>Dependencies & External Prerequisites</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    {summary.dependencies.map((dep, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-2"
                      >
                        <p className="text-slate-300 leading-relaxed font-sans">
                          {dep.text}
                        </p>
                        {dep.citations.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-slate-500 text-[10px]">Citations:</span>
                            {dep.citations.map((c, i) => (
                              <Citation
                                key={i}
                                citation={c}
                                onOpen={setSelectedCitation}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Risks Raised by Delegates */}
                <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-400" />
                      <span>Delegate Concerns & Unverified Claims</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs">
                    {summary.risks.map((risk, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-2"
                      >
                        <p className="text-slate-300 leading-relaxed font-sans">
                          {risk.text}
                        </p>
                        {risk.citations.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-slate-500 text-[10px]">Citations:</span>
                            {risk.citations.map((c, i) => (
                              <Citation
                                key={i}
                                citation={c}
                                onOpen={setSelectedCitation}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Extracted Claims with Citation Chips */}
              <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Technical & Governance Claims Verification</span>
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400">
                    Extracted claims verified against ingested PDF, forum thread, and social records.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  {summary.claims.map((claim) => {
                    const isSupported = claim.support === "supported";
                    return (
                      <div
                        key={claim.id}
                        className="p-3.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-slate-200 font-medium leading-relaxed font-sans text-sm">
                            {claim.text}
                          </p>
                          <Badge
                            className={
                              isSupported
                                ? "bg-emerald-950/80 text-emerald-400 border border-emerald-600/60 font-mono text-[10px]"
                                : "bg-amber-950/80 text-amber-400 border border-amber-600/60 font-mono text-[10px]"
                            }
                          >
                            {isSupported ? "SUPPORTED" : "UNSUPPORTED"} (
                            {Math.round(claim.pSupported * 100)}%)
                          </Badge>
                        </div>

                        {claim.citations.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-900">
                            <span className="text-slate-500 text-[11px] font-mono">
                              Verified citations:
                            </span>
                            {claim.citations.map((c, i) => (
                              <Citation
                                key={i}
                                citation={c}
                                onOpen={setSelectedCitation}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* 2. EXECUTION TAB */}
        <TabsContent value="execution">
          <EvidenceTable proposalId={proposalId} />
        </TabsContent>

        {/* 3. EVIDENCE TAB (Placeholder) */}
        <TabsContent value="evidence">
          <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>Document Ingestion & Chunk Store</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Normalized chunks extracted from governance PDFs, Discourse threads, and on-chain records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-slate-300">
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">PDF Specification</span>
                  <span className="font-bold text-slate-200">proposal.pdf (3-4 pages)</span>
                  <span className="text-[10px] text-emerald-400 block mt-1">✓ SHA-256 Verified</span>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Forum Thread</span>
                  <span className="font-bold text-slate-200">Discourse #1021</span>
                  <span className="text-[10px] text-emerald-400 block mt-1">✓ 9 Posts Ingested</span>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Social Sentiment</span>
                  <span className="font-bold text-slate-200">5 Messages Ingested</span>
                  <span className="text-[10px] text-emerald-400 block mt-1">✓ Timestamp Synced</span>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">On-chain Calldata</span>
                  <span className="font-bold text-slate-200">Timelock ProposalCreated</span>
                  <span className="text-[10px] text-red-400 block mt-1">⚠ 2 Anomaly Calls</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 4. CONFLICTS TAB (Placeholder) */}
        <TabsContent value="conflicts">
          <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-indigo-400" />
                <span>Conflict-of-Interest & Sybil Graph Network</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Forensic wallet transfer trails and hidden delegate voting collusion links.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="rounded-lg bg-slate-950 p-4 border border-slate-800 space-y-2">
                <div className="text-indigo-400 font-bold text-xs uppercase tracking-wider">
                  Detected Collusion & Laundering Trails:
                </div>
                {proposalId === "MIP-21" ? (
                  <ul className="space-y-1.5 text-slate-300">
                    <li>• Proposer Wallet 13 transferred 2.0 ETH seed capital to Alt Wallet 14 (Path [13, 14], P=0.95)</li>
                    <li>• Alt Wallet 14 routed capital to Proposer Secondary Wallet 17 (Path [14, 17], P=0.90)</li>
                    <li>• 4 Whale Colluders (Wallets 18, 19, 20, 21) control 61.0% delegated voting power</li>
                  </ul>
                ) : (
                  <ul className="space-y-1.5 text-slate-300">
                    <li>• Proposer Wallet 10 transferred 25 ETH to Intermediary 11 (offset 1100)</li>
                    <li>• Intermediary 11 transferred 20 ETH to Recipient Wallet 12 (Nexus Labs, offset 1110)</li>
                    <li>• Proposer 10 secretly funded Whale 18 (5 ETH) and Whale 19 (5 ETH)</li>
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 5. RISK TAB (Placeholder) */}
        <TabsContent value="risk">
          <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-400" />
                <span>4-Stage Bayesian Risk Model</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Multi-layer risk score calculation across bytecode diff, financial anomaly, Sybil voting, and COI graph.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Stage 1: Calldata Drift</span>
                  <span className="font-bold text-red-400 text-sm">0.98 (CRITICAL)</span>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Stage 2: Treasury Risk</span>
                  <span className="font-bold text-red-400 text-sm">0.95 (CRITICAL)</span>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Stage 3: Graph Collusion</span>
                  <span className="font-bold text-amber-400 text-sm">0.88 (HIGH)</span>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Stage 4: Sybil Quorum</span>
                  <span className="font-bold text-amber-400 text-sm">0.82 (HIGH)</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 6. TIMELINE TAB (Placeholder) */}
        <TabsContent value="timeline">
          <Card className="border-slate-800 bg-slate-900/80 shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-400" />
                <span>Governance & Timelock Lifecycle</span>
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Key milestone events tracked across the proposal lifecycle.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="border-l-2 border-indigo-500 pl-4 space-y-3">
                <div>
                  <span className="text-indigo-400 font-bold block">1. Forum Draft Posted</span>
                  <span className="text-slate-400 text-[11px]">Discourse thread #1021 opened for community discussion.</span>
                </div>
                <div>
                  <span className="text-indigo-400 font-bold block">2. On-chain Proposal Scheduled</span>
                  <span className="text-slate-400 text-[11px]">ProposalCreated event fired on Governance Timelock.</span>
                </div>
                <div>
                  <span className="text-amber-400 font-bold block">3. Watchdog Simulation Flagged</span>
                  <span className="text-slate-400 text-[11px]">ProofOfIntent identified 2 critical unauthorized actions.</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block">4. Voting Deadline</span>
                  <span className="text-slate-500 text-[11px]">Pending delegate votes and timelock execution queue.</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Interactive Citation Inspection Dialog */}
      <Dialog
        open={selectedCitation !== null}
        onOpenChange={(open) => !open && setSelectedCitation(null)}
      >
        <DialogContent className="max-w-lg border-indigo-900 bg-slate-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-300 font-mono text-sm">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span>Citation Source Chunk: {selectedCitation?.chunkId}</span>
            </DialogTitle>
            <DialogDescription className="font-mono text-xs text-slate-400">
              Verbatim source excerpt referenced by decision verifier.
            </DialogDescription>
          </DialogHeader>

          {selectedCitation && (
            <div className="space-y-3 pt-2 text-xs font-mono">
              <div className="rounded-lg bg-slate-950 p-3.5 border border-slate-800 space-y-2">
                <span className="text-slate-500 text-[10px] uppercase tracking-wider block">
                  Verbatim Excerpt
                </span>
                <p className="text-slate-200 italic font-sans text-sm leading-relaxed">
                  &ldquo;{selectedCitation.quote}&rdquo;
                </p>
              </div>

              <div className="space-y-1.5 text-[11px] text-slate-400 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Source URI:</span>
                  <span className="text-slate-300 truncate max-w-[260px]">
                    {selectedCitation.sourceUri}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">SHA-256 Hash:</span>
                  <span className="text-slate-300 truncate max-w-[260px]">
                    {selectedCitation.sha256}
                  </span>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  size="sm"
                  onClick={() => setSelectedCitation(null)}
                  className="h-8 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
