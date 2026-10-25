"use client";

import React from "react";
import type { Citation as CitationType } from "@/types/shared";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { useEvidencePanel } from "@/components/EvidencePanel";
import { ExternalLink, Hash, FileText, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

interface CitationChipProps {
  citation: CitationType;
  index?: number;
  onOpen?: (citation: CitationType) => void;
  className?: string;
  showChunkId?: boolean;
}

export function Citation({
  citation,
  index,
  onOpen,
  className,
  showChunkId = false,
}: CitationChipProps) {
  const { openCitation } = useEvidencePanel();

  const shaPrefix = citation.sha256
    ? `${citation.sha256.slice(0, 8)}...${citation.sha256.slice(-4)}`
    : "unknown";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpen) {
      onOpen(citation);
    }
    openCitation(citation);
  };

  return (
    <HoverCard openDelay={100} closeDelay={150}>
      <HoverCardTrigger
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium",
          "bg-indigo-950/80 border border-indigo-700/60 text-indigo-300",
          "hover:bg-indigo-900 hover:border-indigo-400 hover:text-indigo-100 transition-colors cursor-pointer select-none",
          className
        )}
      >
        {index !== undefined ? (
          <span className="font-bold text-indigo-200">[{index}]</span>
        ) : (
          <Quote className="w-2.5 h-2.5 text-indigo-400" />
        )}
        {showChunkId && <span>{citation.chunkId}</span>}
      </HoverCardTrigger>

      <HoverCardContent align="start" className="w-80 space-y-2 border-indigo-900/60 bg-slate-900 shadow-2xl p-3 z-50">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase text-indigo-400 flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {index !== undefined && <span className="font-bold">[{index}]</span>} {citation.chunkId}
          </span>
          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
            <Hash className="w-2.5 h-2.5" />
            {shaPrefix}
          </span>
        </div>

        <div className="rounded bg-slate-950/90 p-2.5 border border-slate-800/80">
          <p className="text-[11px] italic text-slate-200 leading-relaxed font-sans">
            &ldquo;{citation.quote}&rdquo;
          </p>
        </div>

        <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
          <span className="truncate max-w-[200px] font-mono text-slate-500" title={citation.sourceUri}>
            {citation.sourceUri}
          </span>
          <span className="inline-flex items-center gap-1 text-indigo-400 font-medium hover:underline">
            Inspect <ExternalLink className="w-2.5 h-2.5" />
          </span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
