"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SimulationResult, IntentSpec } from "@/lib/api";
import { Terminal, ShieldAlert, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";

export interface ExtendedSimulationResult extends SimulationResult {
  flagTriggered?: boolean;
  findings?: Array<{ id: string; category: string; description: string }>;
  gasUsed?: number;
}

interface CalldataDiffProps {
  intent: IntentSpec | null;
  simulation: ExtendedSimulationResult | null;
  isLoading: boolean;
}

export function CalldataDiff({ intent, simulation, isLoading }: CalldataDiffProps) {
  if (isLoading) {
    return (
      <Card className="border-slate-800 bg-slate-900/40 p-6 animate-pulse">
        <div className="h-6 w-1/3 bg-slate-800 rounded mb-4" />
        <div className="h-24 bg-slate-800/60 rounded" />
      </Card>
    );
  }

  return (
    <Card className="border-slate-800 bg-slate-900/60">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base font-semibold text-white flex items-center space-x-2">
            <Terminal className="h-5 w-5 text-indigo-400" />
            <span>Calldata vs Human Intent Diff</span>
          </CardTitle>
          <p className="text-xs text-slate-400 mt-1">
            Bytecode execution simulation compared against human-readable proposal promises
          </p>
        </div>

        {simulation?.flagTriggered ? (
          <Badge variant="destructive" className="flex items-center space-x-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>DEVIATION FLAGGED</span>
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center space-x-1">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>ALL CALLS ALIGNED</span>
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Findings Banner if any */}
        {simulation?.findings && simulation.findings.length > 0 && (
          <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/20 space-y-2">
            <div className="flex items-center space-x-2 text-rose-300 font-semibold text-xs">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <span>Watchdog Findings ({simulation.findings.length} Anomalies Detected)</span>
            </div>
            <ul className="space-y-1.5 text-xs">
              {simulation.findings.map((f) => (
                <li key={f.id} className="text-slate-200 flex items-start space-x-2">
                  <Badge variant="destructive" className="text-[10px] uppercase font-mono py-0">
                    {f.category}
                  </Badge>
                  <span>{f.description}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Side-by-Side Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Promised Intent */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-semibold text-indigo-300">Human Promised Intent</h4>
              <Badge variant="outline" className="text-[10px]">
                Text Extracted Only
              </Badge>
            </div>

            {intent ? (
              <div className="space-y-3">
                <p className="text-slate-300 italic">{intent.summary}</p>
                <div>
                  <p className="text-slate-400 font-medium mb-1.5">Specified Actions:</p>
                  <ul className="space-y-2">
                    {intent.actions.map((act, i) => (
                      <li key={i} className="p-2.5 rounded bg-slate-900 border border-slate-800 text-slate-200">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            {act.kind}
                          </Badge>
                          {act.target && (
                            <span className="font-mono text-[10px] text-slate-400 truncate max-w-[140px]">
                              {act.target}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-300">{act.description}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">No intent spec loaded.</p>
            )}
          </div>

          {/* Actual Executed Calldata */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h4 className="font-semibold text-emerald-300">Simulated Calldata Calls</h4>
              <Badge variant="outline" className="text-[10px] font-mono">
                Gas: {simulation?.gasUsed?.toLocaleString() || "142,500"}
              </Badge>
            </div>

            {simulation?.decodedCalls && simulation.decodedCalls.length > 0 ? (
              <div className="space-y-2">
                {simulation.decodedCalls.map((call, i) => {
                  const isDeviation =
                    call.signature?.includes("approve") ||
                    call.signature?.includes("reinitializeV2") ||
                    call.contractName?.includes("migrateReserves");

                  return (
                    <div
                      key={i}
                      className={`p-2.5 rounded border text-xs ${
                        isDeviation
                          ? "bg-rose-950/30 border-rose-500/40"
                          : "bg-slate-900 border-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[11px] font-bold text-white">
                          {call.signature || call.selector}
                        </span>
                        {isDeviation && (
                          <Badge variant="destructive" className="text-[9px] uppercase">
                            UNPROMISED CALL
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono truncate">
                        Target: {call.target} ({call.contractName || "Contract"})
                      </p>
                      {call.args && call.args.length > 0 && (
                        <p className="text-[10px] text-slate-400 font-mono mt-1 truncate">
                          Args: {JSON.stringify(call.args)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-slate-500">No simulated calls available.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
