"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useChunk } from "@/lib/api";
import type { Citation, EvidenceFile, Chunk } from "@/types/shared";
import {
  FileText,
  Hash,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  ExternalLink,
  Layers,
  FileCode,
} from "lucide-react";

export interface EvidenceTarget {
  citation?: Citation;
  file?: EvidenceFile;
  chunkId?: string;
  sourceType?: string;
  sourceUri?: string;
  quote?: string;
  sha256?: string;
  page?: number;
  text?: string;
  bytes?: number;
  title?: string;
}

interface EvidencePanelContextType {
  isOpen: boolean;
  target: EvidenceTarget | null;
  openCitation: (citation: Citation) => void;
  openEvidenceFile: (file: EvidenceFile) => void;
  openChunk: (chunkId: string, quote?: string) => void;
  openTarget: (target: EvidenceTarget) => void;
  closePanel: () => void;
}

const EvidencePanelContext = createContext<EvidencePanelContextType | undefined>(undefined);

export function useEvidencePanel() {
  const ctx = useContext(EvidencePanelContext);
  if (!ctx) {
    throw new Error("useEvidencePanel must be used within an EvidencePanelProvider");
  }
  return ctx;
}

export function EvidencePanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [target, setTarget] = useState<EvidenceTarget | null>(null);

  const openCitation = (citation: Citation) => {
    setTarget({
      citation,
      chunkId: citation.chunkId,
      quote: citation.quote,
      sha256: citation.sha256,
      sourceUri: citation.sourceUri,
      title: `Citation: ${citation.chunkId}`,
    });
    setIsOpen(true);
  };

  const openEvidenceFile = (file: EvidenceFile) => {
    setTarget({
      file,
      sourceType: file.type,
      sourceUri: file.uri,
      sha256: file.sha256,
      bytes: file.bytes,
      title: `Evidence File: ${file.uri.split("/").pop() || file.uri}`,
    });
    setIsOpen(true);
  };

  const openChunk = (chunkId: string, quote?: string) => {
    setTarget({
      chunkId,
      quote,
      title: `Chunk: ${chunkId}`,
    });
    setIsOpen(true);
  };

  const openTarget = (t: EvidenceTarget) => {
    setTarget(t);
    setIsOpen(true);
  };

  const closePanel = () => {
    setIsOpen(false);
  };

  return (
    <EvidencePanelContext.Provider
      value={{
        isOpen,
        target,
        openCitation,
        openEvidenceFile,
        openChunk,
        openTarget,
        closePanel,
      }}
    >
      {children}
      <EvidencePanel />
    </EvidencePanelContext.Provider>
  );
}

/**
 * Normalizes whitespace and highlights the quoted span in fullText with <mark>.
 */
function highlightQuotedSpan(fullText: string, quote?: string): {
  parts: { text: string; isMark: boolean }[];
  found: boolean;
} {
  if (!quote || !quote.trim()) {
    return { found: true, parts: [{ text: fullText, isMark: false }] };
  }

  const cleanQuote = quote.trim();
  // Split on whitespace to allow any whitespace sequence
  const words = cleanQuote.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = words.join("\\s+");

  try {
    const regex = new RegExp(`(${pattern})`, "i");
    const match = fullText.match(regex);
    if (!match || match.index === undefined) {
      return { found: false, parts: [{ text: fullText, isMark: false }] };
    }

    const startIdx = match.index;
    const matchLen = match[0].length;
    const before = fullText.slice(0, startIdx);
    const marked = fullText.slice(startIdx, startIdx + matchLen);
    const after = fullText.slice(startIdx + matchLen);

    return {
      found: true,
      parts: [
        { text: before, isMark: false },
        { text: marked, isMark: true },
        { text: after, isMark: false },
      ],
    };
  } catch {
    return { found: false, parts: [{ text: fullText, isMark: false }] };
  }
}

export function EvidencePanel() {
  const { isOpen, closePanel, target } = useEvidencePanel();

  // Load chunk if chunkId is present
  const { data: chunk, isLoading: isChunkLoading } = useChunk(target?.chunkId || null);

  const [copied, setCopied] = useState(false);
  const [verifyResult, setVerifyResult] = useState<"idle" | "verifying" | "matched" | "mismatched">("idle");
  const [computedHash, setComputedHash] = useState<string | null>(null);

  // Reset verification state when target or chunk changes
  useEffect(() => {
    setVerifyResult("idle");
    setComputedHash(null);
    setCopied(false);
  }, [target, chunk]);

  const sourceType = (chunk?.sourceType || target?.sourceType || target?.file?.type || "evidence").toLowerCase();
  const sourceUri = chunk?.sourceUri || target?.sourceUri || target?.citation?.sourceUri || "unknown";
  const expectedSha256 = chunk?.sha256 || target?.sha256 || target?.citation?.sha256 || target?.file?.sha256 || "";

  // Extract page number if available
  const pageNum = chunk?.page || (() => {
    const match = sourceUri.match(/page=(\d+)/i);
    return match ? match[1] : null;
  })();

  // Resolve full text
  const fullText = chunk?.text || target?.text || target?.file?.uri || "";

  const highlightResult = fullText
    ? highlightQuotedSpan(fullText, target?.quote)
    : { found: true, parts: [] };

  const handleCopyHash = () => {
    if (!expectedSha256) return;
    navigator.clipboard.writeText(expectedSha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleVerify = async () => {
    if (!fullText || !expectedSha256) return;
    setVerifyResult("verifying");

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(fullText);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hex = "0x" + hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
      setComputedHash(hex);

      const normExpected = expectedSha256.startsWith("0x")
        ? expectedSha256.toLowerCase()
        : ("0x" + expectedSha256).toLowerCase();

      if (hex.toLowerCase() === normExpected) {
        setVerifyResult("matched");
      } else {
        setVerifyResult("mismatched");
      }
    } catch {
      setVerifyResult("mismatched");
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "pdf":
        return <Badge className="bg-blue-950/80 text-blue-300 border border-blue-600/60 font-mono text-xs uppercase">PDF Spec</Badge>;
      case "forum":
        return <Badge className="bg-purple-950/80 text-purple-300 border border-purple-600/60 font-mono text-xs uppercase">Discourse Forum</Badge>;
      case "social":
        return <Badge className="bg-sky-950/80 text-sky-300 border border-sky-600/60 font-mono text-xs uppercase">Social Sentiment</Badge>;
      case "onchain":
        return <Badge className="bg-emerald-950/80 text-emerald-300 border border-emerald-600/60 font-mono text-xs uppercase">On-chain Calldata</Badge>;
      case "disclosure":
        return <Badge className="bg-amber-950/80 text-amber-300 border border-amber-600/60 font-mono text-xs uppercase">Proposer Disclosure</Badge>;
      default:
        return <Badge className="bg-slate-800 text-slate-300 border border-slate-700 font-mono text-xs uppercase">{type}</Badge>;
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && closePanel()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl bg-slate-900 border-l border-slate-800 text-slate-100 p-6 overflow-y-auto space-y-5"
      >
        <SheetHeader className="text-left border-b border-slate-800 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-400" />
              <SheetTitle className="text-slate-100 font-bold text-base">
                Evidence Inspector
              </SheetTitle>
            </div>
            {getTypeBadge(sourceType)}
          </div>
          <SheetDescription className="text-xs text-slate-400">
            Cryptographically anchored source evidence with SHA-256 verification.
          </SheetDescription>
        </SheetHeader>

        {isChunkLoading && target?.chunkId ? (
          <div className="p-8 text-center text-slate-400 font-mono text-xs animate-pulse">
            Loading chunk evidence from source store...
          </div>
        ) : (
          <div className="space-y-5 text-xs">
            {/* Source Information Box */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold block">
                Source Document Information
              </span>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-xs font-medium">Type:</span>
                  <span className="font-mono text-slate-200 capitalize font-semibold">{sourceType}</span>
                </div>
                {pageNum && (
                  <Badge variant="outline" className="font-mono text-[11px] border-indigo-700 text-indigo-300">
                    Page {pageNum}
                  </Badge>
                )}
                {target?.bytes && (
                  <span className="text-slate-400 font-mono text-[11px]">
                    Size: {(target.bytes / 1024).toFixed(1)} KB ({target.bytes.toLocaleString()} bytes)
                  </span>
                )}
              </div>

              <div>
                <span className="text-slate-500 text-[11px] block mb-0.5">Source URI:</span>
                <span className="font-mono text-[11px] text-indigo-300 bg-slate-900 px-2 py-1 rounded border border-slate-800 block truncate" title={sourceUri}>
                  {sourceUri}
                </span>
              </div>

              {target?.chunkId && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                  <span>Chunk ID:</span>
                  <span className="font-mono font-bold text-slate-200">{target.chunkId}</span>
                </div>
              )}
            </div>

            {/* Quoted Span Warning (if not found in text) */}
            {!highlightResult.found && target?.quote && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-500/50 bg-amber-950/20 text-amber-200 text-xs">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold block">Warning: Quoted excerpt not verbatim in chunk text</span>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    The requested quote was not matched exactly in this chunk text (it may contain whitespace variations or slight paraphrasing).
                  </p>
                </div>
              </div>
            )}

            {/* Quoted Excerpt Card (if from citation) */}
            {target?.quote && (
              <div className="p-3.5 rounded-xl border border-indigo-900/60 bg-indigo-950/20 space-y-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold block">
                  Referenced Citation Quote
                </span>
                <p className="font-serif italic text-sm text-slate-100 leading-relaxed">
                  &ldquo;{target.quote}&rdquo;
                </p>
              </div>
            )}

            {/* Full Chunk Text with <mark> Highlight */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-semibold">
                  Full Chunk Text Content
                </span>
                {highlightResult.found && target?.quote && (
                  <span className="text-[10px] text-amber-400 font-mono font-medium flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                    Highlighted in &lt;mark&gt;
                  </span>
                )}
              </div>

              {fullText ? (
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 font-sans text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap select-text max-h-[260px] overflow-y-auto">
                  {highlightResult.parts.map((part, i) =>
                    part.isMark ? (
                      <mark
                        key={i}
                        className="bg-amber-400/30 text-amber-100 font-semibold px-1 py-0.5 rounded border border-amber-400/50 shadow-sm"
                      >
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    )
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 text-slate-500 italic text-xs">
                  No text content available for this evidence item.
                </div>
              )}
            </div>

            {/* Monospace SHA-256 Box with Copy Button */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-semibold block">
                Evidence SHA-256 Checksum
              </span>
              <div className="p-3 rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-between gap-3 font-mono text-xs">
                <span className="text-emerald-400 break-all select-all font-mono text-[11px]">
                  {expectedSha256 || "No hash provided"}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyHash}
                  disabled={!expectedSha256}
                  className="h-7 text-xs border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 shrink-0 gap-1 px-2.5"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 text-[10px]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[10px]">Copy</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Verification Section */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-slate-200 font-semibold text-xs block">
                    Client-Side Cryptographic Verification
                  </span>
                  <span className="text-slate-400 text-[11px] block mt-0.5">
                    Computes WebCrypto SHA-256 digest of UTF-8 text and verifies against expected hash.
                  </span>
                </div>

                <Button
                  size="sm"
                  onClick={handleVerify}
                  disabled={verifyResult === "verifying" || !fullText || !expectedSha256}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs gap-1.5 h-8 shrink-0"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{verifyResult === "verifying" ? "Computing..." : "Verify"}</span>
                </Button>
              </div>

              {/* Green Tick or Red Cross Result */}
              {verifyResult === "matched" && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 font-mono text-xs font-semibold animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 stroke-[2.5] shrink-0" />
                  <span>hash matches</span>
                </div>
              )}

              {verifyResult === "mismatched" && (
                <div className="space-y-1.5 p-2.5 rounded-lg border border-red-500/60 bg-red-950/40 text-red-300 font-mono text-xs animate-in fade-in">
                  <div className="flex items-center gap-2 font-semibold">
                    <XCircle className="w-4 h-4 text-red-400 stroke-[2.5] shrink-0" />
                    <span>hash mismatch</span>
                  </div>
                  {computedHash && (
                    <div className="text-[10px] text-red-400/80 break-all pl-6">
                      Computed: {computedHash}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
