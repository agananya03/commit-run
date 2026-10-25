"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import type { CoiReport, WalletLink } from "@/types/shared";
import {
  buildCoiGraph,
  formatAddress,
  ROLE_COLORS,
  HARDHAT_ADDRESSES,
  ADDRESS_TO_INDEX,
  type GraphNode,
  type GraphLink,
  type NodeRole,
} from "@/lib/coiGraph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  GitBranch,
  Copy,
  Check,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Maximize2,
  HelpCircle,
  ArrowRight,
  Info,
} from "lucide-react";

// Dynamically import react-force-graph-2d with ssr: false to prevent window is not defined errors
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] w-full flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-950/80 font-mono text-xs text-slate-400">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      <span>Loading interactive forensic network graph...</span>
    </div>
  ),
});

interface ConflictsGraphProps {
  proposalId: string;
  coi?: CoiReport | null;
}

export function ConflictsGraph({ proposalId, coi }: ConflictsGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 650, height: 540 });
  const [selectedLink, setSelectedLink] = useState<WalletLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<GraphLink | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  // Resize observer to keep graph canvas perfectly responsive
  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.max(320, rect.width),
          height: Math.max(480, 560),
        });
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Build graph data from CoiReport and local wallets/transfers
  const graphData = useMemo(() => {
    return buildCoiGraph(coi, proposalId);
  }, [coi, proposalId]);

  // Configure D3 forces for optimal spacing
  useEffect(() => {
    if (fgRef.current) {
      fgRef.current.d3Force("charge")?.strength(-650);
      fgRef.current.d3Force("link")?.distance(120);
    }
  }, [graphData]);

  // Copy helper
  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedAddr(text);
    setTimeout(() => setCopiedAddr(null), 2000);
  };

  // Determine disclosure signature status: 'valid' | 'invalid' | 'missing wallets'
  const signatureStatus = useMemo<"valid" | "invalid" | "missing wallets">(() => {
    if (!coi) return "invalid";
    if (!coi.signatureValid) return "invalid";
    // If signature is cryptographically valid, check if undisclosed links exist
    if (coi.undisclosedLinks && coi.undisclosedLinks.length > 0) {
      return "missing wallets";
    }
    return "valid";
  }, [coi]);

  const undisclosedLinks = coi?.undisclosedLinks || [];
  const pCoiValue = typeof coi?.pCoi === "number" ? coi.pCoi : 0;

  // Zoom controls
  const handleZoomIn = () => {
    if (fgRef.current) {
      fgRef.current.zoom(fgRef.current.zoom() * 1.3, 300);
    }
  };

  const handleZoomOut = () => {
    if (fgRef.current) {
      fgRef.current.zoom(fgRef.current.zoom() / 1.3, 300);
    }
  };

  const handleZoomFit = () => {
    if (fgRef.current) {
      fgRef.current.zoomToFit(400, 30);
    }
  };

  // Select a link from side panel to focus and highlight
  const handleSelectLink = (link: WalletLink) => {
    setSelectedLink((prev) => (prev === link ? null : link));
    if (fgRef.current && link.path && link.path.length > 0) {
      // Find node positions
      const firstTarget = link.path[0];
      let addr = firstTarget;
      const num = Number(firstTarget);
      if (!isNaN(num) && HARDHAT_ADDRESSES[num]) {
        addr = HARDHAT_ADDRESSES[num];
      }
      const node = graphData.nodes.find((n) => n.id.toLowerCase() === addr.toLowerCase());
      if (node && typeof node.x === "number" && typeof node.y === "number") {
        fgRef.current.centerAt(node.x, node.y, 400);
        fgRef.current.zoom(2.2, 400);
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Overview Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <GitBranch className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>Conflict-of-Interest & Sybil Graph Network</span>
              <Badge variant="outline" className="font-mono text-[10px] text-slate-400 border-slate-700">
                {proposalId}
              </Badge>
            </h2>
            <p className="text-xs text-slate-400">
              Interactive force-directed graph tracing on-chain fund flows, CEX hubs, and undisclosed beneficiary links.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-slate-400">Conflict Score:</span>
          <Badge
            className={`font-mono text-xs px-2.5 py-0.5 ${
              pCoiValue >= 0.8
                ? "bg-red-950/80 text-red-300 border-red-500/60"
                : pCoiValue >= 0.4
                ? "bg-amber-950/80 text-amber-300 border-amber-500/60"
                : "bg-emerald-950/80 text-emerald-300 border-emerald-500/60"
            }`}
          >
            pCOI: {(pCoiValue * 100).toFixed(1)}%
          </Badge>
        </div>
      </div>

      {/* Main Grid: Graph (left) & Side Panel (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Interactive Canvas Graph (7 cols on lg) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <Card className="border-slate-800 bg-slate-950/90 shadow-2xl relative overflow-hidden flex flex-col">
            {/* Top Toolbar: Legend & Zoom controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-900/70 p-3 text-xs">
              {/* Role Legend */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_COLORS.proposer }} />
                  <span className="text-slate-300">Proposer</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_COLORS.disclosed }} />
                  <span className="text-slate-300">Disclosed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_COLORS.recipient }} />
                  <span className="text-slate-300">Recipient</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_COLORS.voter }} />
                  <span className="text-slate-300">Voter</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ROLE_COLORS.hub }} />
                  <span className="text-slate-400">Hub (Grey/Small)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-red-500" />
                  <span className="text-red-400 font-semibold">Undisclosed Link</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleZoomIn}
                  className="h-7 w-7 p-0 border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  title="Zoom In"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleZoomOut}
                  className="h-7 w-7 p-0 border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleZoomFit}
                  className="h-7 px-2 border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 text-[11px] font-mono gap-1"
                  title="Center and Fit View"
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>Fit</span>
                </Button>
              </div>
            </div>

            {/* Canvas Container */}
            <div ref={containerRef} className="relative w-full h-[540px] bg-slate-950 cursor-grab active:cursor-grabbing">
              <ForceGraph2D
                ref={fgRef}
                width={dimensions.width}
                height={dimensions.height}
                graphData={graphData}
                backgroundColor="#020617"
                nodeId="id"
                nodeRelSize={6}
                // Custom node rendering: role colors, labels, grey and small hubs
                nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                  const isHub = node.isHub;
                  const radius = isHub ? 4.5 : node.role === "proposer" ? 9 : node.role === "recipient" ? 8 : 7;
                  const color = isHub ? "#64748b" : node.color || "#8b5cf6";

                  // Check if node is part of selected link
                  const isHighlighted =
                    selectedLink?.path?.some(
                      (p) =>
                        p.toLowerCase() === node.id.toLowerCase() ||
                        Number(p) === node.index ||
                        (HARDHAT_ADDRESSES[Number(p)] &&
                          HARDHAT_ADDRESSES[Number(p)].toLowerCase() === node.id.toLowerCase())
                    ) || node.isUndisclosed;

                  // Draw circle
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.fillStyle = color;
                  ctx.fill();

                  // Stroke / Ring
                  if (isHighlighted) {
                    ctx.strokeStyle = "#ef4444";
                    ctx.lineWidth = 2.5;
                  } else if (node.role === "proposer") {
                    ctx.strokeStyle = "#fbbf24";
                    ctx.lineWidth = 2;
                  } else {
                    ctx.strokeStyle = "#0f172a";
                    ctx.lineWidth = 1;
                  }
                  ctx.stroke();

                  // Text label with semi-transparent background pill
                  const fontSize = isHub ? Math.max(7, 8.5 / globalScale) : Math.max(8.5, 10 / globalScale);
                  ctx.font = `${isHub ? "normal" : "600"} ${fontSize}px Inter, sans-serif`;
                  ctx.textAlign = "center";
                  ctx.textBaseline = "top";

                  const labelText = node.name || formatAddress(node.address);
                  const labelWidth = ctx.measureText(labelText).width;
                  const labelY = node.y + radius + 3;

                  ctx.fillStyle = "rgba(2, 6, 23, 0.75)";
                  ctx.fillRect(node.x - labelWidth / 2 - 3, labelY - 1, labelWidth + 6, fontSize + 3);

                  ctx.fillStyle = isHub ? "#94a3b8" : "#f1f5f9";
                  ctx.fillText(labelText, node.x, labelY);
                }}
                nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
                  const isHub = node.isHub;
                  const radius = isHub ? 5 : 10;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
                  ctx.fillStyle = color;
                  ctx.fill();
                }}
                onNodeHover={(node: any) => setHoveredNode(node || null)}
                d3VelocityDecay={0.3}
                warmupTicks={60}
                cooldownTicks={120}
                // Link styling: thickness by amount, red for undisclosed
                linkWidth={(link: any) => {
                  if (link.isUndisclosed) return 4;
                  return link.width || 1.5;
                }}
                linkColor={(link: any) => {
                  if (link.isUndisclosed) return "#ef4444";
                  return link.color || "#334155";
                }}
                linkDirectionalParticles={(link: any) => (link.isUndisclosed ? 4 : 1)}
                linkDirectionalParticleSpeed={(link: any) => (link.isUndisclosed ? 0.008 : 0.003)}
                linkDirectionalParticleWidth={(link: any) => (link.isUndisclosed ? 3 : 1.5)}
                linkDirectionalParticleColor={(link: any) => (link.isUndisclosed ? "#fca5a5" : "#64748b")}
                linkCanvasObjectMode={() => "after"}
                linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                  if (!link.isUndisclosed || link.pLink === undefined) return;

                  const start = link.source;
                  const end = link.target;
                  if (!start || !end || typeof start.x !== "number" || typeof end.x !== "number") return;

                  // Compute midpoint on canvas
                  const midX = (start.x + end.x) / 2;
                  const midY = (start.y + end.y) / 2;

                  const text = `pLink: ${(link.pLink * 100).toFixed(0)}%`;
                  const fontSize = Math.max(9, 10 / globalScale);
                  ctx.font = `bold ${fontSize}px Inter, sans-serif`;

                  const textMetrics = ctx.measureText(text);
                  const textWidth = textMetrics.width;
                  const padX = 4;
                  const padY = 2;

                  // Pill background
                  ctx.fillStyle = "#dc2626";
                  ctx.beginPath();
                  ctx.roundRect
                    ? ctx.roundRect(
                        midX - textWidth / 2 - padX,
                        midY - fontSize / 2 - padY,
                        textWidth + padX * 2,
                        fontSize + padY * 2,
                        3
                      )
                    : ctx.rect(
                        midX - textWidth / 2 - padX,
                        midY - fontSize / 2 - padY,
                        textWidth + padX * 2,
                        fontSize + padY * 2
                      );
                  ctx.fill();

                  // Text label
                  ctx.fillStyle = "#ffffff";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText(text, midX, midY);
                }}
                onLinkHover={(link: any) => setHoveredLink(link || null)}
                onEngineStop={() => {
                  if (fgRef.current) {
                    fgRef.current.zoomToFit(400, 35);
                  }
                }}
              />

              {/* Floating Tooltip Card */}
              {(hoveredNode || hoveredLink) && (
                <div className="absolute bottom-3 left-3 pointer-events-none rounded-lg border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-xl backdrop-blur-md max-w-xs font-mono space-y-1 text-slate-200">
                  {hoveredNode && (
                    <>
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hoveredNode.color }} />
                        <span>{hoveredNode.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 break-all select-all">
                        {hoveredNode.address}
                      </div>
                      <div className="text-[11px] text-slate-300 flex justify-between gap-3 pt-1 border-t border-slate-800">
                        <span>Role:</span>
                        <span className="uppercase font-semibold text-indigo-400">{hoveredNode.role}</span>
                      </div>
                      {hoveredNode.mrdBalance > 0 && (
                        <div className="text-[11px] text-slate-300 flex justify-between gap-3">
                          <span>Voting MRD:</span>
                          <span className="text-emerald-400">
                            {(hoveredNode.mrdBalance / 1e6).toFixed(1)}M MRD
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {!hoveredNode && hoveredLink && (
                    <>
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            hoveredLink.isUndisclosed ? "bg-red-500" : "bg-slate-400"
                          }`}
                        />
                        <span>
                          {hoveredLink.isUndisclosed ? "Undisclosed Transfer Link" : "Standard Transfer"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 flex justify-between gap-3">
                        <span>Amount:</span>
                        <span className="text-emerald-400 font-bold">{hoveredLink.amount || "N/A"}</span>
                      </div>
                      {hoveredLink.pLink !== undefined && (
                        <div className="text-[11px] text-red-300 flex justify-between gap-3">
                          <span>Link Probability:</span>
                          <span className="font-bold">{(hoveredLink.pLink * 100).toFixed(1)}%</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Side Panel (5 cols on lg) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* 1. Disclosure Signature Status Card */}
          <Card className="border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-slate-800/80">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-400" />
                  <span>Disclosure Signature Status</span>
                </CardTitle>

                {/* Status Badge: valid / invalid / missing wallets */}
                {signatureStatus === "valid" ? (
                  <Badge className="bg-emerald-950 text-emerald-300 border border-emerald-500/60 font-mono text-xs gap-1 py-0.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>valid</span>
                  </Badge>
                ) : signatureStatus === "missing wallets" ? (
                  <Badge className="bg-amber-950 text-amber-300 border border-amber-500/60 font-mono text-xs gap-1 py-0.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>missing wallets</span>
                  </Badge>
                ) : (
                  <Badge className="bg-red-950 text-red-300 border border-red-500/60 font-mono text-xs gap-1 py-0.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                    <span>invalid</span>
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs text-slate-400">
                {signatureStatus === "valid"
                  ? "Proposer provided a valid EIP-191 personal_sign with all beneficiary accounts disclosed."
                  : signatureStatus === "missing wallets"
                  ? "Signature verified, but the statement withheld alt wallets and hidden beneficiaries."
                  : "Disclosure signature failed cryptographic verification or was missing from evidence."}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3 font-mono text-xs">
              {/* Proposer Info */}
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 space-y-1">
                <div className="text-[11px] text-slate-400">Proposer Author Address:</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-200 font-semibold break-all text-[11px]">
                    {coi?.proposer || "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec"}
                  </span>
                  <button
                    onClick={(e) =>
                      handleCopy(e, coi?.proposer || "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec")
                    }
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors shrink-0"
                    title="Copy address"
                  >
                    {copiedAddr === (coi?.proposer || "0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec") ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Disclosed Wallets Count */}
              <div className="p-2.5 rounded-lg border border-slate-800 bg-slate-950 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">Declared Operational Wallets:</span>
                  <span className="text-[11px] font-bold text-slate-300">
                    {(coi?.disclosed || []).length} Wallets
                  </span>
                </div>

                {coi?.disclosed && coi.disclosed.length > 0 ? (
                  <div className="space-y-1">
                    {coi.disclosed.map((w, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded bg-slate-900 px-2 py-1 text-[11px] text-emerald-400 border border-emerald-900/30"
                      >
                        <span className="truncate">{formatAddress(w)}</span>
                        <Badge variant="outline" className="text-[9px] border-emerald-700/60 text-emerald-300">
                          Disclosed #{idx + 1}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 italic">
                    None declared. Proposer claimed zero external associated wallets.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 2. Undisclosed WalletLinks List */}
          <Card className="border-slate-800 bg-slate-900/90 shadow-xl overflow-hidden flex-1 flex flex-col">
            <CardHeader className="pb-3 border-b border-slate-800/80">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span>Undisclosed Conflict Links</span>
                </CardTitle>
                <Badge
                  variant={undisclosedLinks.length > 0 ? "destructive" : "success"}
                  className="font-mono text-xs"
                >
                  {undisclosedLinks.length} Detected
                </Badge>
              </div>
              <CardDescription className="text-xs text-slate-400">
                Laundering hops and seed transactions omitted from the signed disclosure.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-4 space-y-3 font-mono text-xs flex-1 overflow-y-auto max-h-[400px]">
              {undisclosedLinks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 text-center space-y-2 rounded-xl border border-emerald-900/30 bg-emerald-950/20">
                  <ShieldCheck className="w-8 h-8 text-emerald-400" />
                  <div className="font-semibold text-emerald-300 text-sm">Clean Disclosure Verified</div>
                  <div className="text-slate-400 text-xs max-w-xs font-sans">
                    No undisclosed links or illicit fund routing paths were discovered for this proposal.
                  </div>
                </div>
              ) : (
                undisclosedLinks.map((link: WalletLink, idx: number) => {
                  const isSelected = selectedLink === link;
                  const pLinkPct = (link.pLink * 100).toFixed(0);

                  const fromIdx = ADDRESS_TO_INDEX[link.from?.toLowerCase()] ?? "?";
                  const toIdx = ADDRESS_TO_INDEX[link.to?.toLowerCase()] ?? "?";

                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectLink(link)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
                        isSelected
                          ? "border-red-500 bg-red-950/40 shadow-lg ring-1 ring-red-500"
                          : "border-red-900/50 bg-red-950/20 hover:border-red-600 hover:bg-red-950/30"
                      }`}
                    >
                      {/* Link Header */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-red-200">
                          <span>Wallet #{fromIdx}</span>
                          <ArrowRight className="w-3.5 h-3.5 text-red-400" />
                          <span>Wallet #{toIdx}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge className="bg-red-900/90 text-red-100 border border-red-500 font-mono text-[10px] px-1.5 py-0.2">
                            pLink: {pLinkPct}%
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[10px] text-slate-400 border-slate-700">
                            {link.hops} hop{link.hops > 1 ? "s" : ""}
                          </Badge>
                        </div>
                      </div>

                      {/* Path Trail */}
                      {link.path && link.path.length > 0 && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-950 p-1.5 rounded border border-slate-800 flex-wrap">
                          <span className="text-slate-500">Path:</span>
                          {link.path.map((step, sIdx) => (
                            <React.Fragment key={sIdx}>
                              <span className="text-slate-300 font-mono">
                                {formatAddress(step)}
                              </span>
                              {sIdx < link.path.length - 1 && (
                                <ArrowRight className="w-3 h-3 text-red-400 shrink-0" />
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      )}

                      {/* Plain English Reasons */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">
                          Forensic Evidence (Plain English):
                        </div>
                        <ul className="space-y-1 text-[11px] font-sans text-slate-300">
                          {link.reasons && link.reasons.length > 0 ? (
                            link.reasons.map((reason, rIdx) => (
                              <li key={rIdx} className="flex items-start gap-1.5">
                                <span className="text-red-400 font-bold shrink-0 mt-0.5">•</span>
                                <span>{reason}</span>
                              </li>
                            ))
                          ) : (
                            <li className="text-slate-500 italic">Direct undisclosed fund flow on-chain</li>
                          )}
                        </ul>
                      </div>

                      {/* Click to inspect hint */}
                      <div className="text-[10px] text-indigo-400 flex items-center justify-end gap-1 pt-1 border-t border-red-900/30">
                        <span>Click to center graph</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
