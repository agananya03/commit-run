"use client";

import React, { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Chunk } from "@/lib/api";
import { FileText, MessageSquare, Twitter, Layers, Hash } from "lucide-react";

interface EvidenceTrailProps {
  chunks: Chunk[];
  isLoading: boolean;
}

export function EvidenceTrail({ chunks, isLoading }: EvidenceTrailProps) {
  const [activeTab, setActiveTab] = useState("all");

  const filterChunks = (type: string) => {
    if (type === "all") return chunks;
    return chunks.filter((c) => c.sourceType === type);
  };

  const getSourceIcon = (type: string) => {
    switch (type) {
      case "forum":
        return <MessageSquare className="h-4 w-4 text-sky-400" />;
      case "pdf":
        return <FileText className="h-4 w-4 text-rose-400" />;
      case "social":
        return <Twitter className="h-4 w-4 text-indigo-400" />;
      case "onchain":
        return <Layers className="h-4 w-4 text-emerald-400" />;
      default:
        return <FileText className="h-4 w-4 text-slate-400" />;
    }
  };

  if (isLoading) {
    return (
      <Card className="border-slate-800 bg-slate-900/40 p-6 animate-pulse">
        <div className="h-6 w-1/4 bg-slate-800 rounded mb-4" />
        <div className="space-y-3">
          <div className="h-16 bg-slate-800/60 rounded" />
          <div className="h-16 bg-slate-800/60 rounded" />
        </div>
      </Card>
    );
  }

  const displayed = filterChunks(activeTab);

  return (
    <Card className="border-slate-800 bg-slate-900/60">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold text-white flex items-center space-x-2">
            <span>Evidence Trail & Ingested Chunks</span>
            <Badge variant="outline" className="text-xs">
              {chunks.length} Total Chunks
            </Badge>
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            Hash-chained chunks with verifiable SHA-256 commitments
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All ({chunks.length})</TabsTrigger>
            <TabsTrigger value="pdf">PDF</TabsTrigger>
            <TabsTrigger value="forum">Forum</TabsTrigger>
            <TabsTrigger value="social">Social</TabsTrigger>
            <TabsTrigger value="onchain">Onchain</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent>
        <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
          {displayed.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">
              No evidence chunks found for this filter.
            </p>
          ) : (
            displayed.map((chunk) => (
              <div
                key={chunk.id}
                className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-950/60 hover:border-slate-700 transition-all text-xs"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    {getSourceIcon(chunk.sourceType)}
                    <span className="font-mono font-bold text-indigo-300">
                      {chunk.id}
                    </span>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {chunk.sourceType}
                    </Badge>
                    {chunk.page && (
                      <span className="text-slate-400 text-[11px]">
                        Page {chunk.page}
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] font-mono text-slate-400 truncate max-w-xs">
                    {chunk.sourceUri}
                  </span>
                </div>

                <p className="text-slate-200 font-sans leading-relaxed whitespace-pre-wrap bg-slate-900/50 p-2.5 rounded-lg border border-slate-800/40">
                  {chunk.text}
                </p>

                <div className="mt-2.5 flex items-center space-x-2 text-[10px] text-slate-400 font-mono">
                  <Hash className="h-3 w-3 text-emerald-400" />
                  <span className="truncate">SHA256: {chunk.sha256}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
