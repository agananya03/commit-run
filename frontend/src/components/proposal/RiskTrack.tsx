"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowRight, Code2, FileText, Lock, Network, Play, RotateCcw, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { PLAIN_FINDING } from "@/lib/plain";
import { NumberTicker } from "@/components/fx/NumberTicker";
import { Rise } from "@/components/fx/Motion";
import type { Finding, RiskChain } from "@/types/shared";

const EASE = [0.22, 1, 0.36, 1] as const;
const HOP_MS = 1100;

const STAGES = [
  { id: "claims", label: "Promises", q: "Do the sources back what it says?", Icon: FileText, tab: "summary" },
  { id: "coi", label: "Connections", q: "Is the proposer tied to who benefits?", Icon: Network, tab: "conflicts" },
  { id: "voting", label: "Votes", q: "Who holds the deciding votes?", Icon: Vote, tab: "risk" },
  { id: "execution", label: "Code", q: "Does the code do what it says?", Icon: Code2, tab: "execution" },
] as const;

const VERDICT = {
  halt: { word: "Freeze it", line: "The risk is too high to let it run. The watchdog freezes it on-chain.", color: "#B392FF", text: "text-danger" },
  review: { word: "Get a human review", line: "Suspicious enough that people should look before it runs.", color: "#8E7FC4", text: "text-caution" },
  none: { word: "Let it run", line: "Nothing here suggests it does anything other than what it says.", color: "#7E7A9E", text: "text-verified" },
} as const;

const toneColor = (p: number) => (p >= 0.8 ? "#B392FF" : p >= 0.1 ? "#8E7FC4" : "#7E7A9E");
const toneText = (p: number) => (p >= 0.8 ? "text-danger" : p >= 0.1 ? "text-caution" : "text-verified");
const fmtX = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ""));

function effectPhrase(lr: number | null): string {
  if (lr === null) return "No evidence either way";
  if (lr > 1.01) return `${fmtX(lr)}× more likely to be harmful`;
  if (lr < 0.99) return `${fmtX(1 / lr)}× less likely to be harmful`;
  return "Didn't change anything";
}

/**
 * The risk chain as one travelling packet (after Magic UI's AnimatedBeam idea, built here): it starts at the
 * prior, visits the four checks in order while the running risk ticks, and either rolls through to "Let it run"
 * or is stopped at the gate. Plays once when scrolled into view; Replay runs it again.
 */
export function RiskTrack({ risk, findings = [], onSelectTab }: { risk: RiskChain | null | undefined; findings?: Finding[]; onSelectTab: (t: string) => void }) {
  const reduce = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const inView = useInView(trackRef, { once: true, margin: "-15% 0px" });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [step, setStep] = useState(-1);

  const stages = useMemo(
    () =>
      STAGES.map((s) => {
        const real = risk?.stages.find((x) => x.stage === s.id) ?? null;
        return { ...s, lr: real?.likelihoodRatio ?? null, probability: real?.probability ?? null, explanation: real?.explanation ?? "", findingIds: real?.findingIds ?? [] };
      }),
    [risk],
  );
  // running risk at each stop: 0 = start, 1..4 = after each check, 5 = verdict
  const running = useMemo(() => {
    const out = [risk?.prior ?? 0.05];
    for (const s of stages) out.push(s.probability ?? out[out.length - 1]!);
    out.push(risk?.posterior ?? out[out.length - 1]!);
    return out;
  }, [risk, stages]);
  const [selected, setSelected] = useState<string>(() => [...stages].sort((a, b) => (b.lr ?? 0) - (a.lr ?? 0))[0]!.id);
  const action = risk?.action ?? "none";
  const verdict = VERDICT[action];
  const halted = action === "halt";

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (reduce) {
      setStep(5);
      return;
    }
    setStep(0);
    for (let k = 1; k <= 5; k++) timers.current.push(setTimeout(() => setStep(k), k * HOP_MS));
  }, [reduce]);

  useEffect(() => {
    if (inView && risk) play();
    return () => timers.current.forEach(clearTimeout);
  }, [inView, risk, play]);

  if (!risk) return <p className="rounded-[24px] border border-line bg-panel p-8 text-lg text-muted">This proposal hasn&apos;t been scored yet.</p>;

  const cur = Math.max(0, step);
  const sentence =
    step <= 0
      ? `Every proposal starts at ${Math.round(running[0]! * 100)}%: most are fine.`
      : step <= 4
      ? `${stages[step - 1]!.label}: ${effectPhrase(stages[step - 1]!.lr).toLowerCase()}.`
      : verdict.line;
  // stop k sits at the centre of column k+1 of 6
  const at = (k: number) => `${(100 / 12) * (2 * k + 1)}%`;
  const packetStop = halted && step >= 5 ? 4.62 : cur; // a halted packet hits the gate just before the verdict

  const detail = stages.find((s) => s.id === selected)!;
  const detailFindings = detail.findingIds.map((id) => findings.find((f) => f.id === id)).filter((f): f is Finding => Boolean(f));

  return (
    <div className="space-y-6">
      {/* running risk and what just happened */}
      <Rise>
        <div className="flex flex-wrap items-end justify-between gap-6 rounded-[24px] border border-line bg-panel p-6 sm:p-8">
          <div>
            <div className="text-xs font-medium text-faint">{step >= 5 ? "Final risk" : "Risk so far"}</div>
            <div className={cn("mt-1 text-[clamp(52px,6vw,84px)] font-semibold leading-none tracking-tight transition-colors duration-500", toneText(running[cur]!))}>
              <NumberTicker value={Math.round(running[cur]! * 1000) / 10} format={(v) => `${v.toFixed(1)}%`} />
            </div>
            <AnimatePresence mode="wait">
              <motion.p key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }} className="mt-3 max-w-[52ch] text-lg text-muted">
                {sentence}
              </motion.p>
            </AnimatePresence>
          </div>
          <button onClick={play} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-5 py-2.5 text-sm font-medium text-ink shadow-sm transition-colors hover:border-ink/25">
            <RotateCcw className="h-4 w-4" /> Replay
          </button>
        </div>
      </Rise>

      {/* the track */}
      <div ref={trackRef} className="relative overflow-hidden rounded-[28px] bg-night px-2 pb-8 pt-16 sm:px-6">
        <div aria-hidden className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-ice/10 blur-[90px]" />
        {halted && step >= 5 && <div aria-hidden className="absolute -right-16 -top-16 h-72 w-72 rounded-full bg-danger/25 blur-[90px]" />}

        <div className="relative h-14">
          {/* Reflect's horizontal lens flare under the rail */}
          <div aria-hidden className="pointer-events-none absolute inset-x-[6%] top-1/2 h-10 -translate-y-1/2 rounded-full bg-[#8B5CF6]/15 blur-2xl" />
          {/* base line, and the lit part behind the packet */}
          <div className="absolute top-1/2 h-px -translate-y-1/2 bg-white/10" style={{ left: at(0), right: `${100 / 12}%` }} />
          {/* animated elements use top: calc(), not -translate-y: Motion's inline transform would override it */}
          <motion.div
            className="absolute h-[2px] origin-left rounded-full"
            style={{
              top: "calc(50% - 1px)",
              left: at(0),
              width: `${(100 / 12) * 10}%`,
              background: `linear-gradient(90deg, rgba(255,255,255,0.4), ${toneColor(running[cur]!)})`,
              boxShadow: `0 0 10px ${toneColor(running[cur]!)}`,
            }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: step < 0 ? 0 : Math.min(packetStop, 5) / 5 }}
            transition={{ duration: HOP_MS / 1000 - 0.35, ease: EASE }}
          />

          {/* stops */}
          {[{ label: "Start", Icon: Play }, ...stages.map((s) => ({ label: s.label, Icon: s.Icon })), { label: verdict.word, Icon: halted ? Lock : Play }].map((s, k) => {
            const reached = step >= k;
            const stage = k >= 1 && k <= 4 ? stages[k - 1]! : null;
            const color = k === 0 ? "#C4B5FD" : k === 5 ? verdict.color : stage?.lr === null ? "#4A4766" : toneColor(running[k]!);
            return (
              <button
                key={k}
                onClick={() => stage && setSelected(stage.id)}
                className={cn("absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center", !stage && "cursor-default")}
                style={{ left: at(k) }}
              >
                {stage && reached && stage.lr !== null && (
                  <motion.span
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute -top-9 whitespace-nowrap rounded-md border px-2 py-0.5 font-code text-[11px] font-medium text-white"
                    style={{ borderColor: `${color}80`, background: "#1d1442" }}
                  >
                    ×{fmtX(stage.lr)}
                  </motion.span>
                )}
                {/* hollow orbit stops that light up, instead of flat coloured discs */}
                <motion.span
                  animate={{
                    backgroundColor: reached ? "#1d1442" : "#0C0B1D",
                    borderColor: reached ? color : "rgba(255,255,255,0.12)",
                    color: reached ? "#FFFFFF" : "#6F6C8C",
                    boxShadow: reached ? `0 0 18px -2px ${color}` : "0 0 0 0 rgba(0,0,0,0)",
                    scale: step === k ? 1.12 : 1,
                  }}
                  transition={{ duration: 0.35 }}
                  className={cn("flex h-11 w-11 items-center justify-center rounded-full border", selected === stage?.id && "ring-4 ring-white/10")}
                >
                  <s.Icon className="h-4 w-4" />
                </motion.span>
                <span className={cn("absolute top-12 whitespace-nowrap text-xs font-medium", reached ? "text-ice-light" : "text-ice-light/40", k === 5 && reached && "text-sm font-semibold")} style={k === 5 && reached ? { color } : undefined}>
                  {s.label}
                </span>
              </button>
            );
          })}

          {/* the gate that stops a harmful proposal */}
          {halted && (
            <motion.div
              aria-hidden
              className="absolute h-16 w-[2px] origin-top rounded-full bg-white shadow-[0_0_14px_2px_#b392ff]"
              style={{ top: "calc(50% - 32px)", left: `calc(${(100 / 12) * (2 * 4.75 + 1)}% - 1px)` }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: step >= 5 ? 1 : 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            />
          )}

          {/* the packet */}
          {step >= 0 && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
              initial={false}
              animate={{
                left: at(packetStop),
                boxShadow: halted && step >= 5 ? "0 0 0 5px rgba(179,146,255,.22), 0 0 24px 4px #b392ff" : "0 0 0 5px rgba(196,181,253,.14), 0 0 20px 2px #c4b5fd",
              }}
              transition={{ duration: HOP_MS / 1000 - 0.35, ease: EASE }}
            />
          )}
        </div>
        <div className="h-10" />
      </div>

      {/* the four checks */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((s, i) => {
          const reached = step >= i + 1;
          return (
            <Rise key={s.id} delay={i * 0.06}>
              <button
                onClick={() => setSelected(s.id)}
                className={cn(
                  "h-full w-full rounded-[22px] border bg-panel p-5 text-left transition-all duration-200 hover:-translate-y-0.5",
                  selected === s.id ? "border-evidence/50 shadow-[0_18px_40px_-24px_rgba(139,92,246,0.6)]" : "border-line",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas text-evidence">
                    <s.Icon className="h-4 w-4" />
                  </span>
                  <span className="text-xs text-faint">Check {i + 1}</span>
                </div>
                <div className="mt-4 text-lg font-medium text-ink">{s.label}</div>
                <div className="text-sm text-muted">{s.q}</div>
                <div className={cn("mt-4 text-sm font-semibold", s.lr === null ? "text-faint" : toneText(running[i + 1]!))}>{effectPhrase(s.lr)}</div>
                <div className="mt-1 text-xs text-faint">
                  {s.lr === null ? "not scored for this proposal" : reached ? `risk after this check: ${Math.round(running[i + 1]! * 100)}%` : "…"}
                </div>
              </button>
            </Rise>
          );
        })}
      </div>

      {/* what the selected check found */}
      <AnimatePresence mode="wait">
        <motion.div
          key={detail.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
          className="rounded-[24px] border border-line bg-panel p-6 sm:p-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-faint">What the {detail.label.toLowerCase()} check found</div>
              <h3 className="mt-2 text-2xl font-medium tracking-tight text-ink">{detail.lr === null ? "Nothing to report here." : effectPhrase(detail.lr)}</h3>
            </div>
            {detail.tab !== "risk" && (
              <button onClick={() => onSelectTab(detail.tab)} className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-sm font-medium text-evidence hover:underline">
                See the evidence <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
          {detail.explanation && <p className="mt-4 max-w-[70ch] text-[15px] leading-relaxed text-muted">{detail.explanation}</p>}
          {detailFindings.length > 0 && (
            <ul className="mt-5 space-y-2">
              {detailFindings.map((f) => (
                <li key={f.id} className="flex gap-3 rounded-2xl bg-canvas px-4 py-3">
                  <span className={cn("mt-2 h-2 w-2 flex-shrink-0 rounded-full", f.severity === "critical" ? "bg-danger" : f.severity === "high" || f.severity === "medium" ? "bg-caution" : "bg-faint")} />
                  <div>
                    <div className="text-[15px] text-ink">{PLAIN_FINDING[f.category]}</div>
                    <div className="mt-0.5 text-xs text-faint">{f.does}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-6 text-xs text-faint">
            How the score works: each check multiplies the odds. Above 1× makes harm more likely, below 1× less likely. The final number decides: freeze, review, or let it run.
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
