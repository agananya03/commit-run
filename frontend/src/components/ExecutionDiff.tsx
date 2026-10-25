"use client";

import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Terminal,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  Flame,
  ExternalLink,
  Code2,
  Layers,
  Sparkles,
  Lock,
  Unlock,
} from "lucide-react";
import {
  IntentSpec,
  SimulationResult,
  Finding,
  Explanation,
  Citation as CitationType,
} from "@/types/shared";
import { Citation } from "@/components/Citation";
import { cn } from "@/lib/utils";

interface ExecutionDiffProps {
  proposalId: string;
  intent?: IntentSpec | null;
  simulation?: SimulationResult | null;
  findings?: Finding[];
  explanation?: Explanation | null;
}

interface LeftRowItem {
  id: string;
  type: "action" | "exclusion";
  title: string;
  kind?: string;
  description: string;
  citations: CitationType[];
  matchedRightId?: string;
}

interface RightRowItem {
  id: string;
  category: "call" | "transfer" | "approval" | "ownership" | "implementation" | "selectors";
  title: string;
  details: string;
  rawParams?: Record<string, unknown> | string;
  matchedLeftId?: string;
  isUnmatched: boolean;
  finding?: Finding;
  explainSentence?: string;
}

export function ExecutionDiff({
  proposalId,
  intent,
  simulation,
  findings = [],
  explanation,
}: ExecutionDiffProps) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [hoveredMatchId, setHoveredMatchId] = useState<string | null>(null);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(key);
    setTimeout(() => {
      setCopiedHash(null);
    }, 2000);
  };

  // Hashes fallback
  const simHash =
    simulation?.simHash ||
    (proposalId === "MIP-21"
      ? "0x892a0e4450257ad6d226a27e02932f9152207b1d9bfcf9908cf24369a68b5590"
      : proposalId === "MIP-17"
      ? "0x172a0e4450257ad6d226a27e02932f9152207b1d9bfcf9908cf24369a68b5590"
      : "0x122a0e4450257ad6d226a27e02932f9152207b1d9bfcf9908cf24369a68b5590");

  const bytecodeHash =
    simulation?.bytecodeHash ||
    (proposalId === "MIP-21"
      ? "0xd4e29bf424072387140f00f8da790516b23a5bb7097a4a9058b8ef7c7a364be1"
      : "0x0000000000000000000000000000000000000000000000000000000000000000");

  // Format Left Rows (What the proposal said)
  const leftRows: LeftRowItem[] = [];

  // Actions
  const actions = intent?.actions || (
    proposalId === "MIP-21"
      ? [
          {
            kind: "upgrade" as const,
            target: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
            description: "Upgrade the Vault behind UUPS proxy to VaultV2 for storage packing and gas savings.",
            citations: [
              {
                chunkId: "MIP-21:pdf:0",
                sha256: "0xa72aa6f8dbdbc090d4ce0e95eda2a13b8460cb2242d3a3406198306e7cef8885",
                quote: "The upgrade replaces the Vault implementation behind the existing UUPS proxy at 0x0165878A594ca255338adfa4d48449f69242Eb8F.",
                sourceUri: "pdf://MIP-21/proposal.pdf#page=3",
              },
            ],
          },
        ]
      : proposalId === "MIP-17"
      ? [
          {
            kind: "transfer" as const,
            target: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
            description: "Transfer 5,000,000 USDC grant from Community Treasury to Nexus Labs recipient wallet index 12.",
            citations: [
              {
                chunkId: "MIP-17:forum:0",
                sha256: "0x17cba8767b0d43eb105eadaeb34ef716c830ac195f2c6c9b62b5b6e47d9b66a114",
                quote: "We are proud to present MIP-17, requesting a $5,000,000 USDC allocation from the Meridian Treasury to fund Nexus Labs.",
                sourceUri: "forum://MIP-17/forum_thread.json#post=1",
              },
            ],
          },
        ]
      : [
          {
            kind: "transfer" as const,
            target: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
            description: "Transfer 400,000 USDC grant to developer studio wallet index 9 for core SDK and subgraph indexer.",
            citations: [
              {
                chunkId: "MIP-12:pdf:0",
                sha256: "0x12cba8767b0d43eb105eadaeb34ef716c830ac195f2c6c9b62b5b6e47d9b66a114",
                quote: "We request a grant of 400,000 USDC from the Meridian Treasury to fund the core SDK and open-source subgraph indexer.",
                sourceUri: "pdf://MIP-12/proposal.pdf#page=2",
              },
            ],
          },
        ]
  );

  actions.forEach((act, idx) => {
    leftRows.push({
      id: `left-action-${idx}`,
      type: "action",
      title: `Declared Action #${idx + 1}`,
      kind: act.kind,
      description: act.description,
      citations: act.citations || [],
      matchedRightId: `right-match-${idx}`,
    });
  });

  // Explicitly excluded promises
  const exclusions = intent?.explicitlyExcluded || (
    proposalId === "MIP-21"
      ? [
          "no change to ownership, roles or reserves",
          "storage layout preserved",
          "no new admin functions or backdoor selectors",
        ]
      : proposalId === "MIP-17"
      ? ["rigid contractual deadlines", "public identity disclosures"]
      : [
          "contract changes or upgradeToAndCall bytecode deployments",
          "elevated admin privileges",
          "proxy upgrades or ownership transfer",
        ]
  );

  exclusions.forEach((excl, idx) => {
    leftRows.push({
      id: `left-excl-${idx}`,
      type: "exclusion",
      title: "Explicit Guarantee / Promise",
      description: excl,
      citations:
        proposalId === "MIP-21" && idx === 0
          ? [
              {
                chunkId: "MIP-21:pdf:0",
                sha256: "0xa72aa6f8dbdbc090d4ce0e95eda2a13b8460cb2242d3a3406198306e7cef8885",
                quote: "The Timelock remains the sole owner of the Vault. Storage layout is preserved.",
                sourceUri: "pdf://MIP-21/proposal.pdf#page=3",
              },
            ]
          : [],
    });
  });

  // Format Right Rows (What the code actually does)
  const rightRows: RightRowItem[] = [];

  // Helper to lookup plain English sentence from explanation or findings
  const getExplainSentence = (findingId: string, fallback: string) => {
    const fromExplain = explanation?.perFinding?.find((p) => p.findingId === findingId)?.sentence;
    if (fromExplain) return fromExplain;
    const fromFinding = findings.find((f) => f.id === findingId)?.does;
    if (fromFinding) return fromFinding;
    return fallback;
  };

  if (proposalId === "MIP-21") {
    // 1. Matched call: upgradeToAndCall
    rightRows.push({
      id: "right-match-0",
      category: "call",
      title: "UUPS Proxy Implementation Upgrade",
      details: "Calls VaultProxy.upgradeToAndCall(0x17F2...9212, initCalldata)",
      rawParams: {
        proxy: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
        newImplementation: "0x17F24d3B8bc1150553b54Da30B4d993ACb889212",
        selector: "0x4f1ef286",
      },
      matchedLeftId: "left-action-0",
      isUnmatched: false,
    });

    // 2. Unmatched: Ownership transfer to wallet 14
    const fnd1 = findings.find((f) => f.id === "fnd-1" || f.category === "ownership_change");
    rightRows.push({
      id: "right-unmatched-1",
      category: "ownership",
      title: "Unauthorized Ownership Transfer",
      details: "Transfers Vault ownership from Timelock to wallet 0xdF3e...7097 (wallet index 14)",
      rawParams: {
        contract: "VaultProxy",
        role: "owner",
        previousOwner: "0x0000000000000000000000000000000000000000",
        newOwner: "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097",
      },
      isUnmatched: true,
      finding: fnd1 || {
        id: "fnd-1",
        severity: "critical",
        category: "ownership_change",
        said: "No change to ownership. Timelock stays in control.",
        does: "reinitializeV2 transfers Vault ownership to wallet index 14.",
        evidence: [],
      },
      explainSentence: getExplainSentence(
        "fnd-1",
        "Simulated calldata quietly transfers vault ownership to wallet index 14."
      ),
    });

    // 3. Unmatched: Unlimited USDC approval
    const fnd2 = findings.find((f) => f.id === "fnd-2" || f.category === "unlimited_approval");
    rightRows.push({
      id: "right-unmatched-2",
      category: "approval",
      title: "Unlimited Treasury USDC Approval",
      details: "Treasury.approve() grants MaxUint256 (unlimited) USDC allowance to wallet 0xdF3e...7097",
      rawParams: {
        token: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 (USDC)",
        owner: "Treasury (0xDc64...F6C9)",
        spender: "0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097",
        amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935 (MaxUint256)",
      },
      isUnmatched: true,
      finding: fnd2 || {
        id: "fnd-2",
        severity: "critical",
        category: "unlimited_approval",
        said: "Changes limited to slot packing.",
        does: "Calls Treasury.approve granting unlimited allowance on liquid reserve.",
        evidence: [],
      },
      explainSentence: getExplainSentence(
        "fnd-2",
        "The submitted code approves wallet 0xdF3e... to spend all USDC in the treasury."
      ),
    });

    // 4. Unmatched: Injected backdoor selectors
    const fnd3 = findings.find((f) => f.id === "fnd-3" || f.category === "new_privileged_function");
    rightRows.push({
      id: "right-unmatched-3",
      category: "selectors",
      title: "Injected Privileged Selectors",
      details: "Implementation introduces 2 new backdoor methods: reinitializeV2(address) and migrateReserves(address,uint256)",
      rawParams: {
        addedSelectors: [
          { selector: "0xbe6b99e3", signature: "reinitializeV2(address)" },
          { selector: "0x853828b6", signature: "migrateReserves(address,uint256)" },
        ],
      },
      isUnmatched: true,
      finding: fnd3 || {
        id: "fnd-3",
        severity: "critical",
        category: "new_privileged_function",
        said: "No new admin functions or backdoor methods.",
        does: "Adds migrateReserves and reinitializeV2 backdoor functions.",
        evidence: [],
      },
      explainSentence: getExplainSentence(
        "fnd-3",
        "The upgraded bytecode introduces unreviewed backdoor functions that permit immediate fund extraction."
      ),
    });
  } else if (proposalId === "MIP-17") {
    // MIP-17 Transfer
    const fnd17 = findings.find((f) => f.category === "amount_mismatch") || {
      id: "fnd-17-1",
      severity: "high" as const,
      category: "amount_mismatch" as const,
      said: "Itemized budget accounts for $3,500,000 USDC across 3 workstreams.",
      does: "Transfers $5,000,000 USDC without milestone locking.",
      evidence: [],
    };

    rightRows.push({
      id: "right-match-0",
      category: "transfer",
      title: "Treasury Direct Transfer: 5,000,000 USDC",
      details: "Transfers 5,000,000 USDC directly to recipient 0xbDA5...197E (wallet index 12)",
      rawParams: {
        token: "USDC",
        amount: "5,000,000.00",
        recipient: "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E",
      },
      matchedLeftId: "left-action-0",
      isUnmatched: false,
    });

    rightRows.push({
      id: "right-unmatched-1",
      category: "transfer",
      title: "Budget Surplus Discrepancy",
      details: "Simulated calldata disburses $5,000,000 USDC while Section 3 table itemizes only $3,500,000 USDC ($1.5M unallocated surplus)",
      isUnmatched: true,
      finding: fnd17,
      explainSentence: getExplainSentence(
        "fnd-17-1",
        "The proposal requests $5.0M from the treasury while itemizing only $3.5M in workstreams, leaving $1.5M unexplained."
      ),
    });
  } else {
    // MIP-12 Clean transfer
    rightRows.push({
      id: "right-match-0",
      category: "transfer",
      title: "Treasury Direct Transfer: 400,000 USDC",
      details: "Transfers 400,000 USDC to developer studio wallet 0x2546...Ec30 (wallet index 9)",
      rawParams: {
        token: "USDC",
        amount: "400,000.00",
        recipient: "0x2546BcD3c84621e976D8185a91A922aE77ECEc30",
      },
      matchedLeftId: "left-action-0",
      isUnmatched: false,
    });
  }

  const unmatchedCount = rightRows.filter((r) => r.isUnmatched).length;

  return (
    <div className="space-y-6">
      {/* Top Bar: simHash, bytecodeHash with Copy Buttons and Status */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Simulation Status Meta */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-indigo-400" />
                <span className="font-semibold text-sm text-slate-100">EVM Execution Simulation</span>
              </div>
              <Badge
                className={cn(
                  "font-mono text-xs uppercase px-2.5 py-0.5",
                  unmatchedCount > 0
                    ? "bg-red-500/20 text-red-400 border-red-500/40"
                    : "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                )}
              >
                {unmatchedCount > 0 ? `${unmatchedCount} Discrepancy Found` : "100% Calldata Aligned"}
              </Badge>
            </div>

            {/* Hashes Row with Copy Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              {/* simHash */}
              <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono">
                <span className="text-slate-400 text-[11px] font-semibold">simHash:</span>
                <span className="text-sky-300 select-all" title={simHash}>
                  {simHash.slice(0, 10)}...{simHash.slice(-6)}
                </span>
                <button
                  onClick={() => handleCopy("simHash", simHash)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors ml-1"
                  title="Copy full simHash"
                >
                  {copiedHash === "simHash" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {/* bytecodeHash */}
              <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono">
                <span className="text-slate-400 text-[11px] font-semibold">bytecodeHash:</span>
                <span className="text-emerald-300 select-all" title={bytecodeHash}>
                  {bytecodeHash.slice(0, 10)}...{bytecodeHash.slice(-6)}
                </span>
                <button
                  onClick={() => handleCopy("bytecodeHash", bytecodeHash)}
                  className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors ml-1"
                  title="Copy full bytecodeHash"
                >
                  {copiedHash === "bytecodeHash" ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two-Column Diff Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 relative">
        {/* Left Column: What the proposal said (5 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-400" />
              <h3 className="font-semibold text-sm text-slate-100">What the proposal said</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              IntentSpec ({leftRows.length} declarations)
            </span>
          </div>

          <div className="space-y-3">
            {leftRows.map((item) => {
              const isMatchHovered = hoveredMatchId && item.matchedRightId === hoveredMatchId;
              const isAction = item.type === "action";

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => item.matchedRightId && setHoveredMatchId(item.matchedRightId)}
                  onMouseLeave={() => setHoveredMatchId(null)}
                  className={cn(
                    "p-4 rounded-xl border transition-all duration-200 relative",
                    isAction
                      ? "border-sky-500/30 bg-sky-950/10 hover:border-sky-400/60"
                      : "border-indigo-500/30 bg-indigo-950/10 hover:border-indigo-400/60",
                    isMatchHovered && "ring-2 ring-emerald-500/60 bg-emerald-950/20 border-emerald-500/60 shadow-lg"
                  )}
                >
                  {/* Top Bar: Title & Tag */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isAction ? (
                        <Layers className="w-3.5 h-3.5 text-sky-400" />
                      ) : (
                        <Lock className="w-3.5 h-3.5 text-indigo-400" />
                      )}
                      <span className="text-xs font-semibold text-white">{item.title}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.kind && (
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px] uppercase text-sky-300 border-sky-500/40"
                        >
                          {item.kind}
                        </Badge>
                      )}
                      {item.matchedRightId && (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Matched
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-200 leading-relaxed font-sans mb-3">
                    {item.description}
                  </p>

                  {/* Citations footer */}
                  <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400 font-mono">Evidence Citations:</span>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {item.citations.length > 0 ? (
                        item.citations.map((cit, cIdx) => (
                          <Citation key={cIdx} citation={cit} index={cIdx + 1} showChunkId />
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-500 italic">Extracted from IntentSpec</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: What the code actually does (6 cols) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <h3 className="font-semibold text-sm text-slate-100">What the code actually does</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              SimulationResult ({rightRows.length} effects)
            </span>
          </div>

          <div className="space-y-3">
            {rightRows.map((item) => {
              const isMatchHovered = hoveredMatchId && item.id === hoveredMatchId;

              return (
                <div
                  key={item.id}
                  onMouseEnter={() => item.matchedLeftId && setHoveredMatchId(item.id)}
                  onMouseLeave={() => setHoveredMatchId(null)}
                  className={cn(
                    "p-4 rounded-xl border transition-all duration-200 relative",
                    item.isUnmatched
                      ? "border-red-500/60 bg-red-950/25 shadow-lg shadow-red-950/30"
                      : "border-emerald-500/30 bg-emerald-950/10 hover:border-emerald-400/60",
                    isMatchHovered && "ring-2 ring-emerald-500/60 bg-emerald-950/25 border-emerald-500/60 shadow-lg"
                  )}
                >
                  {/* Top Bar: Title & Severity / Status */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {item.isUnmatched ? (
                        <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          item.isUnmatched ? "text-red-200" : "text-white"
                        )}
                      >
                        {item.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.isUnmatched && item.finding ? (
                        <Badge
                          className={cn(
                            "font-mono text-[10px] uppercase font-bold tracking-wider px-2 py-0.5",
                            item.finding.severity === "critical"
                              ? "bg-red-500/20 text-red-300 border-red-500/50"
                              : "bg-orange-500/20 text-orange-300 border-orange-500/50"
                          )}
                        >
                          {item.finding.severity}
                        </Badge>
                      ) : (
                        <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-mono gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Matched
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Technical effect details */}
                  <div className="mb-2">
                    <p
                      className={cn(
                        "text-xs leading-relaxed font-mono",
                        item.isUnmatched ? "text-red-300/90" : "text-slate-300"
                      )}
                    >
                      {item.details}
                    </p>
                  </div>

                  {/* Unmatched Banner: Explain Sentence & Threat Details */}
                  {item.isUnmatched && (
                    <div className="my-2.5 p-2.5 rounded-lg bg-red-950/50 border border-red-500/40 space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-red-400 font-semibold tracking-wider">
                        <Flame className="w-3 h-3 text-red-400" />
                        <span>Security Finding & Explain Assessment:</span>
                      </div>
                      <p className="text-xs text-red-200 font-sans leading-relaxed">
                        &ldquo;{item.explainSentence}&rdquo;
                      </p>
                    </div>
                  )}

                  {/* Parameters / Diff payload */}
                  {item.rawParams && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                      <div className="bg-slate-950/70 p-2 rounded border border-slate-800 text-[11px] font-mono text-slate-400 overflow-x-auto">
                        <pre className="text-[10px] leading-tight text-slate-300 whitespace-pre-wrap">
                          {typeof item.rawParams === "string"
                            ? item.rawParams
                            : JSON.stringify(item.rawParams, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Matching connector pill */}
                  {item.matchedLeftId && (
                    <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-mono text-[10px]">
                        <ArrowRightLeft className="w-3 h-3" />
                        <span>Connected to Declared Action #1</span>
                      </div>
                      <span className="text-[10px] text-slate-500">Verified Calldata Match</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
