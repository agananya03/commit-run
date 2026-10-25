"use client";

import React, { useEffect, useState } from "react";
import { getWatchdogSocket } from "@/lib/api";
import type { ProposalBundle } from "@/types/shared";
import { Check, Loader2, AlertCircle, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export const PIPELINE_STEPS = [
  "ingest",
  "summarize",
  "extractIntent",
  "commit",
  "coi",
  "simulate",
  "verdict",
  "risk",
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export type StepStatus = "pending" | "running" | "completed" | "failed";

const STEP_LABELS: Record<PipelineStep, string> = {
  ingest: "Ingest",
  summarize: "Summarize",
  extractIntent: "Intent",
  commit: "Commit",
  coi: "COI",
  simulate: "Simulate",
  verdict: "Verdict",
  risk: "Risk",
};

interface StepState {
  status: StepStatus;
  ms?: number;
}

interface PipelineProgressProps {
  proposalId: string;
  bundle?: ProposalBundle | null;
}

export function PipelineProgress({ proposalId, bundle }: PipelineProgressProps) {
  // Initalize step states from bundle if available
  const [steps, setSteps] = useState<Record<PipelineStep, StepState>>(() => {
    const initial: Record<PipelineStep, StepState> = {
      ingest: { status: bundle?.proposal ? "completed" : "pending" },
      summarize: { status: bundle?.summary ? "completed" : "pending" },
      extractIntent: { status: bundle?.intent ? "completed" : "pending" },
      commit: { status: bundle?.versions && bundle.versions.length > 0 ? "completed" : "pending" },
      coi: { status: bundle?.coi ? "completed" : "pending" },
      simulate: { status: bundle?.simulation ? "completed" : "pending" },
      verdict: { status: bundle?.findings !== undefined ? "completed" : "pending" },
      risk: { status: bundle?.risk ? "completed" : "pending" },
    };
    return initial;
  });

  // Re-sync if bundle loads later
  useEffect(() => {
    if (bundle) {
      setSteps((prev) => ({
        ingest: { status: bundle.proposal ? "completed" : prev.ingest.status },
        summarize: { status: bundle.summary ? "completed" : prev.summarize.status },
        extractIntent: { status: bundle.intent ? "completed" : prev.extractIntent.status },
        commit: { status: bundle.versions && bundle.versions.length > 0 ? "completed" : prev.commit.status },
        coi: { status: bundle.coi ? "completed" : prev.coi.status },
        simulate: { status: bundle.simulation ? "completed" : prev.simulate.status },
        verdict: { status: bundle.findings !== undefined ? "completed" : prev.verdict.status },
        risk: { status: bundle.risk ? "completed" : prev.risk.status },
      }));
    }
  }, [bundle]);

  // Connect socket.io for live events (fails silently if socket cannot connect)
  useEffect(() => {
    let socket: ReturnType<typeof getWatchdogSocket> | null = null;
    try {
      socket = getWatchdogSocket();
      if (!socket.connected) {
        socket.connect();
      }

      const handleProgress = (data: {
        proposalId: string;
        step: string;
        status: string;
        ms?: number;
      }) => {
        if (!data || data.proposalId !== proposalId) return;

        const stepKey = data.step as PipelineStep;
        if (PIPELINE_STEPS.includes(stepKey)) {
          let mappedStatus: StepStatus = "pending";
          const rawStatus = (data.status || "").toLowerCase();
          if (rawStatus === "running" || rawStatus === "active") mappedStatus = "running";
          else if (rawStatus === "completed" || rawStatus === "done" || rawStatus === "success") mappedStatus = "completed";
          else if (rawStatus === "failed" || rawStatus === "error") mappedStatus = "failed";

          setSteps((prev) => ({
            ...prev,
            [stepKey]: {
              status: mappedStatus,
              ms: data.ms,
            },
          }));
        }
      };

      socket.on("pipeline:progress", handleProgress);

      return () => {
        socket?.off("pipeline:progress", handleProgress);
      };
    } catch {
      // Fail silently if socket can't connect
    }
  }, [proposalId]);

  return (
    <div className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 shadow-md">
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
          Pipeline Verification Stepper
        </span>
        <span className="text-[10px] font-mono text-slate-500">
          Proposal: {proposalId}
        </span>
      </div>

      <div className="flex items-center justify-between overflow-x-auto py-1">
        {PIPELINE_STEPS.map((stepKey, idx) => {
          const stepData = steps[stepKey];
          const isCompleted = stepData.status === "completed";
          const isRunning = stepData.status === "running";
          const isFailed = stepData.status === "failed";
          const isLast = idx === PIPELINE_STEPS.length - 1;

          return (
            <React.Fragment key={stepKey}>
              <div className="flex flex-col items-center shrink-0 group">
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center border text-xs font-mono font-bold transition-all",
                    isCompleted && "bg-emerald-950/80 border-emerald-500 text-emerald-400 shadow-sm shadow-emerald-900/50",
                    isRunning && "bg-indigo-950/80 border-indigo-400 text-indigo-300 animate-pulse ring-2 ring-indigo-500/30",
                    isFailed && "bg-red-950/80 border-red-500 text-red-400",
                    !isCompleted && !isRunning && !isFailed && "bg-slate-950 border-slate-800 text-slate-600"
                  )}
                  title={`${STEP_LABELS[stepKey]}: ${stepData.status}`}
                >
                  {isCompleted && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                  {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />}
                  {isFailed && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                  {!isCompleted && !isRunning && !isFailed && (
                    <span className="text-[10px] text-slate-500">{idx + 1}</span>
                  )}
                </div>

                <span
                  className={cn(
                    "text-[10px] font-mono mt-1 transition-colors whitespace-nowrap",
                    isCompleted && "text-slate-200 font-medium",
                    isRunning && "text-indigo-300 font-bold",
                    isFailed && "text-red-400 font-semibold",
                    !isCompleted && !isRunning && !isFailed && "text-slate-500"
                  )}
                >
                  {STEP_LABELS[stepKey]}
                </span>

                {stepData.ms !== undefined && (
                  <span className="text-[9px] font-mono text-slate-500">
                    {stepData.ms}ms
                  </span>
                )}
              </div>

              {!isLast && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 min-w-[16px] transition-colors",
                    isCompleted ? "bg-emerald-600/70" : "bg-slate-800"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
