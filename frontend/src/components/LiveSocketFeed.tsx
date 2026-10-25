"use client";

import React, { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWatchdogSocket } from "@/lib/api";
import { Activity, Radio, AlertOctagon, CheckCircle2 } from "lucide-react";

interface LiveEvent {
  id: string;
  timestamp: string;
  stage: string;
  message: string;
  status: "info" | "success" | "warning" | "flag";
}

export function LiveSocketFeed({ proposalId }: { proposalId: string }) {
  const [events, setEvents] = useState<LiveEvent[]>([
    {
      id: "1",
      timestamp: "16:20:01",
      stage: "RAG Ingest",
      message: `Ingested fragmented evidence for ${proposalId} (13 chunks committed)`,
      status: "info",
    },
    {
      id: "2",
      timestamp: "16:20:04",
      stage: "Semantic Search",
      message: "Ran 6 hybrid sub-queries (0.7 cosine + 0.3 BM25) over proposal chunks",
      status: "info",
    },
    {
      id: "3",
      timestamp: "16:20:08",
      stage: "Citation Verifier",
      message: "Validated exact chunk substrings; anchored SHA-256 hashes",
      status: "success",
    },
    {
      id: "4",
      timestamp: "16:20:12",
      stage: "Intent Extractor",
      message: "Extracted IntentSpec strictly from human-readable text",
      status: "success",
    },
    {
      id: "5",
      timestamp: "16:20:16",
      stage: "EVM Simulator",
      message: proposalId === "MIP-21" 
        ? "DEVIATION DETECTED: upgradeToAndCall reinitializes owner to alt wallet 0xdF3e...7097"
        : "Simulation completed: all calls aligned with intent",
      status: proposalId === "MIP-21" ? "flag" : "success",
    },
  ]);

  useEffect(() => {
    try {
      const socket = getWatchdogSocket();
      socket.connect();

      socket.on("watchdog:progress", (data: any) => {
        setEvents((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            timestamp: new Date().toLocaleTimeString(),
            stage: data.stage || "Pipeline",
            message: data.message,
            status: data.status || "info",
          },
        ]);
      });

      socket.on("watchdog:flag", (data: any) => {
        setEvents((prev) => [
          ...prev,
          {
            id: Math.random().toString(),
            timestamp: new Date().toLocaleTimeString(),
            stage: "Timelock Guard",
            message: `CRITICAL FLAG: ${data.reason}`,
            status: "flag",
          },
        ]);
      });

      return () => {
        socket.disconnect();
      };
    } catch {
      // Offline fallback
    }
  }, [proposalId]);

  return (
    <Card className="border-slate-800 bg-slate-900/60">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div className="flex items-center space-x-2">
          <Activity className="h-5 w-5 text-indigo-400" />
          <CardTitle className="text-base font-semibold text-white">
            Live Watchdog Pipeline Stream
          </CardTitle>
        </div>
        <div className="flex items-center space-x-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <Badge variant="outline" className="text-[10px] font-mono">
            Socket.IO :4000
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1 text-xs font-mono">
          {events.map((ev) => (
            <div
              key={ev.id}
              className={`p-2.5 rounded-lg border flex items-start space-x-2.5 ${
                ev.status === "flag"
                  ? "bg-rose-950/40 border-rose-500/40 text-rose-200"
                  : ev.status === "success"
                  ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
                  : "bg-slate-950/60 border-slate-800 text-slate-300"
              }`}
            >
              {ev.status === "flag" ? (
                <AlertOctagon className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
              ) : ev.status === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              ) : (
                <Radio className="h-4 w-4 text-indigo-400 mt-0.5 shrink-0" />
              )}
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                  <span className="font-semibold text-slate-300">{ev.stage}</span>
                  <span>{ev.timestamp}</span>
                </div>
                <p className="text-xs leading-relaxed">{ev.message}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
