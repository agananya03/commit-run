"use client";

import React from "react";
import { Citation as CitationType } from "@/lib/api";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { ExternalLink, Hash, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface CitationChipProps {
  citation: CitationType;
  onOpen?: (citation: CitationType) => void;
  className?: string;
}

export function Citation({ citation, onOpen, className }: CitationChipProps) {
  const shaPrefix = citation.sha256
    ? `${citation.sha256.slice(0, 10)}...${citation.sha256.slice(-6)}`
    : "unknown";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpen) {
      onOpen(citation);
    }
  };

  return (
    <HoverCard openDelay={100} closeDelay={150}>
      <HoverCardTrigger
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono",
          "bg-indigo-950/70 border border-indigo-700/50 text-indigo-300",
          "hover:bg-indigo-900 hover:border-indigo-500 hover:text-indigo-100 transition-colors cursor-pointer",
          className
        )}
      >
        <FileText className="w-3 h-3 text-indigo-400" />
        <span>{citation.chunkId}</span>
      </HoverCardTrigger>

      <HoverCardContent align="start" className="w-80 space-y-2 border-indigo-900/60 bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase text-indigo-400 flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {citation.chunkId}
          </span>
          <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
            <Hash className="w-2.5 h-2.5" />
            {shaPrefix}
          </span>
        </div>

        <div className="rounded bg-slate-950/80 p-2 border border-slate-800/80">
          <p className="text-[11px] italic text-slate-300 leading-relaxed font-sans">
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
