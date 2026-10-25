"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, CircleHelp, Code2, Quote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildPairs, type Pair, type PairStatus } from "@/lib/promiseVsCode";
import { Citation } from "@/components/Citation";
import { ExecutionDiff } from "@/components/ExecutionDiff";
import { NumberTicker } from "@/components/fx/NumberTicker";
import { Rise } from "@/components/fx/Motion";
import { NightPanel } from "@/components/proposal/TabNav";
import type { Explanation, Finding, IntentSpec, SimulationResult } from "@/types/shared";

const EASE = [0.22, 1, 0.36, 1] as const;

const STATUS: Record<PairStatus, { label: string; stroke: string; text: string; ring: string; Icon: typeof Check }> = {
  broken: { label: "Broken", stroke: "#B392FF", text: "text-danger", ring: "border-danger/30 bg-danger/[0.04]", Icon: X },
  matches: { label: "Matches", stroke: "#7E7A9E", text: "text-verified", ring: "border-verified/30 bg-verified/[0.04]", Icon: Check },
  unclear: { label: "Unclear", stroke: "#8E7FC4", text: "text-caution", ring: "border-caution/30 bg-caution/[0.04]", Icon: CircleHelp },
};

/** "pdf://MIP-21/proposal.pdf#page=3" → "Proposal PDF, page 3" */
function sourceLabel(uri: string): string {
  const page = /page=(\d+)/.exec(uri)?.[1];
  const post = /post=(\d+)/.exec(uri)?.[1];
  if (uri.startsWith("pdf")) return `Proposal PDF${page ? `, page ${page}` : ""}`;
  if (uri.startsWith("forum")) return `Forum thread${post ? `, post ${post}` : ""}`;
  if (uri.startsWith("social")) return "Social posts";
  return uri.split("://")[0] ?? uri;
}

/** The connector between promise and consequence: draws itself, then the verdict badge pops in. */
function Connector({ status, delay }: { status: PairStatus; delay: number }) {
  const s = STATUS[status];
  return (
    <div className="relative hidden items-center justify-center md:flex">
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="absolute inset-x-0 top-1/2 h-3 w-full -translate-y-1/2 overflow-visible">
        <motion.line
          x1="0"
          y1="5"
          x2="100"
          y2="5"
          stroke={s.stroke}
          strokeWidth={status === "broken" ? 2.5 : 1.8}
          strokeDasharray={status === "unclear" ? "4 4" : undefined}
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-10% 0px" }}
          transition={{ duration: 0.6, delay, ease: EASE }}
          style={status === "broken" ? { filter: "drop-shadow(0 0 6px rgba(167,139,250,.55))" } : undefined}
        />
      </svg>
      <motion.span
        initial={{ scale: 0, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true, margin: "-10% 0px" }}
        transition={{ type: "spring", stiffness: 420, damping: 18, delay: delay + 0.5 }}
        className={cn("relative z-10 flex flex-col items-center gap-1 rounded-2xl bg-canvas px-2 py-1.5", s.text)}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-md" style={{ background: s.stroke }}>
          <s.Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] font-semibold">{s.label}</span>
      </motion.span>
    </div>
  );
}

function PairRow({ pair, index, onSelectTab }: { pair: Pair; index: number; onSelectTab: (t: string) => void }) {
  const s = STATUS[pair.status];
  const delay = 0.25 + index * 0.05;
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] md:gap-0">
      {/* the promise */}
      <Rise delay={index * 0.05}>
        <div className="h-full rounded-[22px] border border-line bg-panel p-6">
          <Quote className="h-5 w-5 text-faint" />
          <p className="mt-3 text-[17px] leading-relaxed text-ink">&ldquo;{pair.said}&rdquo;</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-faint">
            {pair.citations.length > 0 ? (
              <>
                {pair.citations.map((c, i) => (
                  <Citation key={i} citation={c} index={i + 1} />
                ))}
                <span>{sourceLabel(pair.citations[0]!.sourceUri)}</span>
              </>
            ) : (
              <span>From the proposal text</span>
            )}
          </div>
        </div>
      </Rise>

      <Connector status={pair.status} delay={delay} />
      <div className={cn("flex items-center gap-2 text-xs font-semibold md:hidden", s.text)}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ background: s.stroke }}>
          <s.Icon className="h-3.5 w-3.5" />
        </span>
        {s.label}
      </div>

      {/* the consequence */}
      <Rise delay={index * 0.05 + 0.15}>
        <div className={cn("h-full rounded-[22px] border p-6", s.ring)}>
          {pair.effect ? (
            <>
              <p className="text-[17px] font-medium leading-relaxed text-ink">{pair.effect.headline}</p>
              {pair.effect.changes.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {pair.effect.changes.map((c, i) => (
                    <li key={i} className="rounded-2xl bg-panel px-4 py-3">
                      <div className="text-[11px] font-medium text-faint">{c.what}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-code text-[13px]">
                        {c.before !== undefined && (
                          <>
                            <span className="rounded-md bg-canvas px-2 py-0.5 text-faint line-through decoration-faint/60">{c.before}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-faint" />
                          </>
                        )}
                        <span className={cn("rounded-md px-2 py-0.5 font-semibold", pair.status === "broken" ? "bg-danger/10 text-danger" : pair.status === "matches" ? "bg-verified/10 text-verified" : "bg-caution/10 text-caution")}>
                          {c.after}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-faint">
                Seen when we ran the exact code on a copy of the chain{pair.effect.call ? <> · <span className="font-code">{pair.effect.call}</span></> : null}
              </p>
            </>
          ) : (
            <>
              <p className="text-[17px] font-medium leading-relaxed text-ink">{pair.does ?? "Not established from the available evidence."}</p>
              <p className="mt-3 text-xs text-faint">{pair.note ?? "The simulation doesn't show this, so we don't count it as proven."}</p>
              {pair.note?.includes("money trail") && (
                <button onClick={() => onSelectTab("conflicts")} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-evidence hover:underline">
                  See the money trail <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </>
          )}
        </div>
      </Rise>
    </div>
  );
}

export function PromiseVsCode({
  proposalId,
  intent,
  simulation,
  findings,
  explanation,
  onSelectTab,
}: {
  proposalId: string;
  intent: IntentSpec | null | undefined;
  simulation: SimulationResult | null | undefined;
  findings: Finding[] | undefined;
  explanation: Explanation | null | undefined;
  onSelectTab: (t: string) => void;
}) {
  const { pairs, exclusions } = useMemo(() => buildPairs(intent, simulation, findings), [intent, simulation, findings]);
  const [raw, setRaw] = useState(false);
  const count = (s: PairStatus) => pairs.filter((p) => p.status === s).length;

  if (!intent && !simulation) {
    return <p className="rounded-[24px] border border-line bg-panel p-8 text-lg text-muted">The watchdog hasn&apos;t run this proposal&apos;s code yet.</p>;
  }

  return (
    <div className="space-y-6">
      <Rise>
        <div className="grid gap-6 rounded-[24px] border border-line bg-panel p-6 sm:p-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div className="flex gap-8">
            {(["broken", "matches", "unclear"] as const).map((s) => (
              <div key={s}>
                <NumberTicker value={count(s)} className={cn("text-5xl font-semibold tracking-tight", count(s) ? STATUS[s].text : "text-faint")} />
                <div className="mt-1 text-sm text-muted">{s === "broken" ? "promises broken" : s === "matches" ? "match the code" : "can't be settled"}</div>
              </div>
            ))}
          </div>
          {explanation?.paragraph && (
            <div className="lg:border-l lg:border-line lg:pl-8">
              <div className="text-xs font-medium text-faint">In plain words · written by AI from the findings</div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink">{explanation.paragraph}</p>
            </div>
          )}
        </div>
      </Rise>

      <div className="hidden grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] px-2 pt-4 md:grid">
        <span className="eyebrow !text-faint">The proposal said</span>
        <span />
        <span className="eyebrow !text-faint">The code does</span>
      </div>

      <div className="space-y-5">
        {pairs.map((p, i) => (
          <PairRow key={p.id} pair={p} index={i} onSelectTab={onSelectTab} />
        ))}
      </div>

      {exclusions.length > 0 && (
        <Rise>
          <div className="rounded-[24px] border border-line bg-panel p-6 sm:p-8">
            <div className="text-xs font-medium text-faint">It also promised…</div>
            <ul className="mt-4 divide-y divide-line">
              {exclusions.map((e) => {
                const look = e.status === "broken" ? STATUS.broken : e.status === "kept" ? STATUS.matches : { ...STATUS.unclear, stroke: "#6F6C8C", text: "text-faint" };
                return (
                  <li key={e.text} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white" style={{ background: look.stroke }}>
                      <look.Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-[15px] text-ink">&ldquo;{e.text}&rdquo;</span>
                    <span className={cn("text-sm", look.text)}>{e.status === "broken" ? "Broken." : e.status === "kept" ? "Kept." : "Can't check."}</span>
                    <span className="text-sm text-muted">{e.why}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Rise>
      )}

      <div>
        <button onClick={() => setRaw((r) => !r)} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-5 py-2.5 text-sm font-medium text-ink shadow-sm transition-colors hover:border-ink/25">
          <Code2 className="h-4 w-4" />
          {raw ? "Hide the raw code" : "Show the raw code (for engineers)"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", raw && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {raw && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
              <NightPanel className="mt-4">
                <ExecutionDiff proposalId={proposalId} intent={intent} simulation={simulation} findings={findings} explanation={explanation} />
              </NightPanel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
