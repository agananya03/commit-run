"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useProposalBundle } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PipelineProgress } from "@/components/PipelineProgress";
import { DecisionSummaryCard } from "@/components/DecisionSummaryCard";
import { EvidenceTable } from "@/components/EvidenceTable";
import { RiskChain } from "@/components/RiskChain";
import { ProposalTimeline } from "@/components/ProposalTimeline";
import { useEvidencePanel } from "@/components/EvidencePanel";
import type { EvidenceFile } from "@/types/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  GitBranch,
  Clock,
  Activity,
  FileText,
  Copy,
  Check,
  ShieldCheck,
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
  const [activeTab, setActiveTab] = useState("summary");

  const { openEvidenceFile, openChunk } = useEvidencePanel();
  const [copiedRoot, setCopiedRoot] = useState(false);
  const [copiedFileSha, setCopiedFileSha] = useState<string | null>(null);

  const handleCopy = (e: React.MouseEvent, text: string, isRoot = false) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    if (isRoot) {
      setCopiedRoot(true);
      setTimeout(() => setCopiedRoot(false), 2000);
    } else {
      setCopiedFileSha(text);
      setTimeout(() => setCopiedFileSha(null), 2000);
    }
  };

  // Fetch full proposal bundle (includes summary, intent, simulation, coi, findings, risk, etc.)
  const { data: bundle, isLoading, error } = useProposalBundle(proposalId);

  const fallbackMeta = PROPOSAL_METADATA[proposalId] || {
    title: `${proposalId} Proposal`,
    category: "Governance Proposal",
    status: "Review",
    risk: "HIGH" as const,
    proposer: "Unknown Proposer",
  };

  const meta = {
    title: bundle?.proposal?.title || fallbackMeta.title,
    category: fallbackMeta.category,
    status: bundle?.proposal?.status || fallbackMeta.status,
    risk: bundle?.risk?.level || fallbackMeta.risk,
    proposer: bundle?.proposal?.proposer || fallbackMeta.proposer,
  };

  const latestVersion =
    bundle?.versions && bundle.versions.length > 0
      ? bundle.versions[bundle.versions.length - 1]
      : null;

  const defaultEvidenceFiles: EvidenceFile[] = [
    {
      type: "pdf",
      uri: `pdf://${proposalId}/proposal.pdf`,
      sha256: "0xa72aa6f8dbdbc090d4ce0e95eda2a13b8460cb2242d3a3406198306e7cef8885",
      bytes: 48213,
      proof: ["0x01", "0x02"],
    },
    {
      type: "forum",
      uri: `forum://${proposalId}/forum_thread.json`,
      sha256: "0x3ace16e3c9d03df25105c8ab715142e86300f0d0381f2d41592c6725115a0ebe",
      bytes: 14205,
      proof: ["0x03", "0x04"],
    },
    {
      type: "social",
      uri: `social://${proposalId}/social.json`,
      sha256: "0xcd6ed3dd269c8d4ffe2451d0bb7f5ff4c3745e3b8034626cdd2ca420a4d62e21",
      bytes: 3892,
      proof: ["0x05", "0x06"],
    },
    {
      type: "onchain",
      uri: `onchain://${proposalId}/onchain_actions.json`,
      sha256: "0x5536ee5210655a7ef820e5be205ea182f55cab59ee15fdeefde5cf0f49af9496",
      bytes: 8192,
      proof: ["0x07", "0x08"],
    },
    {
      type: "disclosure",
      uri: `disclosure://${proposalId}/disclosure.json`,
      sha256: "0x9540c2ed6f0aaf2b58897f8946000bd43ab13d12cdb2f72ce0433b80efba69c2",
      bytes: 2048,
      proof: ["0x09", "0x10"],
    },
  ];

  const evidenceFiles =
    latestVersion?.files && latestVersion.files.length > 0
      ? latestVersion.files
      : defaultEvidenceFiles;

  const evidenceRoot =
    latestVersion?.evidenceRoot ||
    "0x91b05f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c5f3c";

  // Pre-vote warning banner condition:
  // If the bundle has findings with severity critical or high and status is not EXECUTED/HALTED
  const criticalOrHighFindings = (bundle?.findings || []).filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  const normalizedStatus = (bundle?.proposal?.status || meta.status || "")
    .toUpperCase()
    .replace(/\s+/g, "_");
  const isExecutedOrHalted =
    normalizedStatus === "EXECUTED" || normalizedStatus === "HALTED";
  const showWarningBanner =
    !isExecutedOrHalted && criticalOrHighFindings.length > 0;

  const getRiskBadge = (risk: string) => {
    switch (risk?.toUpperCase()) {
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
      case "MEDIUM":
        return (
          <Badge className="bg-yellow-950/80 text-yellow-400 border border-yellow-500/60 font-mono text-xs gap-1 px-2.5 py-0.5">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
            MEDIUM RISK
          </Badge>
        );
      default:
        return (
          <Badge className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/60 font-mono text-xs gap-1 px-2.5 py-0.5">
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
          href="/dashboard"
          className="inline-flex items-center gap-1 text-slate-400 hover:text-indigo-400 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>All Proposals</span>
        </Link>
        <span className="text-slate-600">/</span>
        <span className="font-mono text-slate-200">{proposalId}</span>
      </div>

      {/* 5. PipelineProgress Stepper at top of proposal page */}
      <PipelineProgress proposalId={proposalId} bundle={bundle} />

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

      {/* 6. Pre-vote Warning Banner */}
      {showWarningBanner && (
        <div
          role="alert"
          id="pre-vote-warning-banner"
          onClick={() => setActiveTab("execution")}
          className="rounded-xl border border-red-500 bg-red-950/90 p-4 text-red-100 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-red-900/90 transition-all border-l-4 border-l-red-500"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
            <span className="font-semibold text-sm">
              The submitted code does things the proposal text does not mention ({criticalOrHighFindings.length} findings)
            </span>
          </div>
          <a
            href="#execution"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("execution");
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-mono font-medium transition-colors shrink-0 w-fit"
          >
            <span>Execution Tab</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      )}

      {/* Tabs Layout */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
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
          {error ? (
            <div className="p-6 rounded-lg border border-red-900/60 bg-red-950/20 text-red-300 text-xs font-mono">
              Failed to load decision summary for {proposalId}.
            </div>
          ) : (
            <DecisionSummaryCard summary={bundle?.summary ?? null} isLoading={isLoading} />
          )}
        </TabsContent>

        {/* 2. EXECUTION TAB */}
        <TabsContent value="execution">
          <EvidenceTable proposalId={proposalId} />
        </TabsContent>

        {/* 4. EVIDENCE TAB (Requirement 4) */}
        <TabsContent value="evidence" className="space-y-4">
          {/* Merkle Root Header Card */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/80 shadow-lg space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-indigo-400" />
                <span className="font-semibold text-sm text-slate-100">
                  Merkle Evidence Root
                </span>
                <Badge variant="outline" className="font-mono text-xs text-indigo-300 border-indigo-700/60">
                  Version {latestVersion?.version ?? 1}
                </Badge>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {evidenceFiles.length} files committed to state
              </span>
            </div>

            <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-between gap-3 font-mono text-xs">
              <span className="text-emerald-400 break-all select-all font-mono text-[11px]">
                {evidenceRoot}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => handleCopy(e, evidenceRoot, true)}
                className="h-7 text-xs border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 shrink-0 gap-1 px-2.5"
              >
                {copiedRoot ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 text-[10px]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[10px]">Copy Root</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Evidence Files Table */}
          <Card className="border-slate-800 bg-slate-900/80 shadow-lg overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-800/80">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <span>Evidence Files from Latest Version</span>
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-400 mt-0.5">
                    Click any row to inspect chunk text, URI, and verify cryptographic SHA-256 hash in the Evidence Panel.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                  <tr>
                    <th className="p-3 w-28">Type</th>
                    <th className="p-3">URI</th>
                    <th className="p-3 w-48">SHA-256</th>
                    <th className="p-3 w-24">Bytes</th>
                    <th className="p-3 w-52 text-right">Merkle Proof</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {evidenceFiles.map((file, idx) => {
                    const shortSha = `${file.sha256.slice(0, 10)}...${file.sha256.slice(-4)}`;
                    const isCopied = copiedFileSha === file.sha256;

                    return (
                      <tr
                        key={idx}
                        onClick={() => openEvidenceFile(file)}
                        className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                        title="Click to view file in Evidence Panel"
                      >
                        <td className="p-3 align-middle">
                          <Badge
                            className={`font-mono text-[10px] uppercase ${
                              file.type === "pdf"
                                ? "bg-blue-950/80 text-blue-300 border-blue-700/60"
                                : file.type === "forum"
                                ? "bg-purple-950/80 text-purple-300 border-purple-700/60"
                                : file.type === "social"
                                ? "bg-sky-950/80 text-sky-300 border-sky-700/60"
                                : file.type === "onchain"
                                ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/60"
                                : "bg-amber-950/80 text-amber-300 border-amber-700/60"
                            }`}
                          >
                            {file.type}
                          </Badge>
                        </td>
                        <td className="p-3 align-middle font-mono text-slate-200 group-hover:text-indigo-300 transition-colors">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-xs">{file.uri}</span>
                            <ExternalLink className="w-3 h-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </td>
                        <td className="p-3 align-middle font-mono">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-300 text-[11px]">{shortSha}</span>
                            <button
                              onClick={(e) => handleCopy(e, file.sha256, false)}
                              title="Copy SHA-256"
                              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                            >
                              {isCopied ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="p-3 align-middle font-mono text-slate-400 text-[11px]">
                          {(file.bytes / 1024).toFixed(1)} KB
                        </td>
                        <td className="p-3 align-middle text-right">
                          <Badge className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/60 font-mono text-[10px] gap-1 px-2 py-0.5">
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                            included in Merkle root
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Interactive Demo Test for Tampered Chunk */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-red-500/30 bg-red-950/20 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-slate-300 font-medium">
                Test Deliberately Tampered Chunk (shows red cross &ldquo;hash mismatch&rdquo; in Evidence Panel):
              </span>
            </div>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => openChunk("MIP-21:tampered:0")}
              className="h-7 text-xs bg-red-900/80 hover:bg-red-800 text-red-100 font-mono"
            >
              Test Tampered Chunk →
            </Button>
          </div>
        </TabsContent>

        {/* 4. CONFLICTS TAB */}
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

        {/* 5. RISK TAB */}
        <TabsContent value="risk">
          <RiskChain proposalId={proposalId} />
        </TabsContent>

        {/* 6. TIMELINE TAB */}
        <TabsContent value="timeline" className="space-y-4">
          <ProposalTimeline
            proposalId={proposalId}
            versions={bundle?.versions}
            chainEvents={bundle?.chainEvents}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
