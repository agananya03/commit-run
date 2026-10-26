"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cpu, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberTicker } from "@/components/fx/NumberTicker";
import { Rise } from "@/components/fx/Motion";
import { NightPanel } from "@/components/proposal/TabNav";
import { useFactCheck } from "@/lib/verify/client";
import { LieBox } from "@/components/proposal/LieBox";
import { CAUGHT, VERDICT, WITNESS_SUB, rulingLine } from "@/components/proposal/factcheckLook";
import type { Board, Statement, Verdict } from "@/lib/verify/factcheck";

const EASE = [0.22, 1, 0.36, 1] as const;

/** "pdf://MIP-21/proposal.pdf#page=3" → "page 3" */
function where(s: Statement): string | null {
  const uri = s.sourceUri ?? "";
  const page = /page=(\d+)/.exec(uri)?.[1];
  const post = /post=(\d+)/.exec(uri)?.[1];
  return page ? `page ${page}` : post ? `post ${post}` : null;
}

/** Shown while the model cross-examines: empty columns with a scan line and a ticking clock. */
function CrossExamining() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => x + 0.1), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <NightPanel className="min-h-[420px]">
      <div className="relative grid h-[400px] grid-cols-5 gap-4 overflow-hidden p-2">
        {Array.from({ length: 5 }, (_, c) => (
          <div key={c} className="space-y-3">
            {Array.from({ length: 4 - (c % 2) }, (_, r) => (
              <motion.div key={r} className="h-20 rounded-2xl border border-white/[0.06] bg-white/[0.03]" animate={{ opacity: [0.35, 0.8, 0.35] }} transition={{ duration: 1.6, repeat: Infinity, delay: (c + r) * 0.12 }} />
            ))}
          </div>
        ))}
        <motion.div className="pointer-events-none absolute inset-y-0 w-40 bg-gradient-to-r from-transparent via-evidence/15 to-transparent" animate={{ x: ["-10rem", "110%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }} style={{ left: 0 }} />
        <div className="absolute inset-x-0 bottom-6 text-center">
          <div className="text-lg font-medium text-ink">Cross-examining the witnesses…</div>
          <div className="mt-1 text-sm text-muted">Checking every sentence against what the code does · {t.toFixed(1)} s</div>
        </div>
      </div>
    </NightPanel>
  );
}

function Badge({ verdict, exact }: { verdict: Verdict; exact?: boolean }) {
  const v = VERDICT[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold", v.text)}>
      <span className="flex h-4 w-4 items-center justify-center rounded-full text-canvas" style={{ background: v.color }}>
        <v.Icon className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      {v.label}
      {exact && <span className="font-normal text-faint">· exact</span>}
    </span>
  );
}

interface Geo {
  l: number;
  r: number;
  y: number;
}

/** The board: witness columns, with a string from each caught (or confirmed) sentence to the code that decided it. */
function WitnessBoard({ board, focus, setFocus, pinned, setPinned }: { board: Board; focus: string | null; setFocus: (id: string | null) => void; pinned: string | null; setPinned: (id: string | null) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<Record<string, Geo>>({});
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const base = el.getBoundingClientRect();
    const g: Record<string, Geo> = {};
    cards.current.forEach((c, id) => {
      const r = c.getBoundingClientRect();
      g[id] = { l: r.left - base.left, r: r.right - base.left, y: r.top - base.top + Math.min(r.height / 2, 34) };
    });
    setGeo(g);
    setSize({ w: base.width, h: base.height });
  }, []);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    const t = setTimeout(measure, 700); // after the cards fade in and fonts settle
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [measure, board]);

  const strings = useMemo(() => {
    const out: { id: string; from: string; verdict: Verdict }[] = [];
    for (const w of board.witnesses)
      for (const s of w.statements) {
        const r = board.rulings[s.id];
        if (r?.evidence && r.verdict !== "unclear") out.push({ id: s.id, from: r.evidence, verdict: r.verdict });
      }
    return out.sort((a, b) => (a.verdict === "contradicted" ? 1 : 0) - (b.verdict === "contradicted" ? 1 : 0)); // red on top
  }, [board]);

  const active = pinned ?? focus;
  const lit = (s: { id: string; from: string }) => !active || s.id === active || s.from === active;
  const litCard = (id: string) => !active || id === active || strings.some((s) => lit(s) && (s.id === id || s.from === id));
  const setRef = (id: string) => (el: HTMLElement | null) => {
    if (el) cards.current.set(id, el);
    else cards.current.delete(id);
  };

  return (
    <div className="overflow-x-auto pb-2 [scrollbar-width:thin]">
      <div ref={wrap} className="relative grid min-w-[1100px] grid-cols-[1.4fr_repeat(4,minmax(0,1fr))] gap-x-5 p-1" onMouseLeave={() => setFocus(null)}>
        <svg className="pointer-events-none absolute inset-0 z-0 overflow-visible" width={size.w} height={size.h}>
          <defs>
            <filter id="string-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {strings.map((s, i) => {
            const a = geo[s.from];
            const b = geo[s.id];
            if (!a || !b) return null;
            const x1 = a.r;
            const x2 = b.l;
            const dx = Math.max(60, (x2 - x1) * 0.45);
            const d = `M ${x1} ${a.y} C ${x1 + dx} ${a.y}, ${x2 - dx} ${b.y}, ${x2} ${b.y}`;
            const red = s.verdict === "contradicted";
            const on = lit(s);
            return (
              <g key={s.id} style={{ opacity: on ? 1 : 0.12, transition: "opacity .25s" }}>
                <motion.path
                  d={d}
                  fill="none"
                  stroke={red ? CAUGHT : "#C4B5FD"}
                  strokeWidth={red ? (active && on ? 2.6 : 1.8) : 1.2}
                  strokeDasharray={red ? undefined : "3 5"}
                  strokeOpacity={red ? 0.95 : 0.45}
                  filter={red ? "url(#string-glow)" : undefined}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.9, delay: 0.5 + i * 0.12, ease: EASE }}
                />
                <motion.circle cx={x1} cy={a.y} r={3} fill={red ? CAUGHT : "#C4B5FD"} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 + i * 0.12 }} />
                <motion.circle cx={x2} cy={b.y} r={3.5} fill={red ? CAUGHT : "#C4B5FD"} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1.3 + i * 0.12, type: "spring", stiffness: 500, damping: 14 }} />
              </g>
            );
          })}
        </svg>

        {board.witnesses.map((w, c) => (
          // the code column keeps a wide gutter on its right so the strings have room to fan out
          <div key={w.id} className={cn("relative z-10 min-w-0", w.id === "code" && "pr-14")}>
            <div className="mb-4 px-1">
              <div className={cn("text-sm font-semibold", w.id === "code" ? "text-evidence" : "text-ink")}>{w.label}</div>
              <div className="text-xs text-faint">{WITNESS_SUB[w.id]}</div>
            </div>
            <div className="space-y-3">
              {w.statements.map((s, r) => {
                const ruling = board.rulings[s.id];
                const isCode = w.id === "code";
                const look = ruling ? VERDICT[ruling.verdict] : null;
                return (
                  <motion.button
                    type="button"
                    key={s.id}
                    ref={setRef(s.id)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: litCard(s.id) ? 1 : 0.35 }}
                    transition={{ duration: 0.35, delay: active ? 0 : c * 0.08 + r * 0.04 }}
                    onMouseEnter={() => setFocus(s.id)}
                    onFocus={() => setFocus(s.id)}
                    onClick={() => setPinned(pinned === s.id ? null : s.id)}
                    className={cn(
                      "block w-full rounded-2xl border p-3.5 text-left outline-none backdrop-blur-md transition-colors focus-visible:ring-2 focus-visible:ring-evidence/40",
                      isCode ? "border-evidence/25 bg-[#1a1440]/85" : look ? look.ring : "border-white/[0.07] bg-panel/80",
                      pinned === s.id && "ring-2 ring-evidence/50",
                    )}
                  >
                    {ruling && <Badge verdict={ruling.verdict} exact={ruling.exact} />}
                    {isCode && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-evidence"><Cpu className="h-3 w-3" /> Seen in the simulation</span>}
                    <p className="mt-2 line-clamp-5 text-[13px] leading-snug text-ink/90">{s.text}</p>
                    {where(s) && <div className="mt-2 text-[11px] text-faint">{where(s)}</div>}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Phones: no strings, each sentence carries its ruling in words. */
function WitnessList({ board }: { board: Board }) {
  const textOf = (id?: string) => board.witnesses.flatMap((w) => w.statements).find((s) => s.id === id)?.text;
  return (
    <div className="space-y-6">
      {board.witnesses
        .filter((w) => w.id !== "code")
        .map((w) => (
          <div key={w.id}>
            <div className="text-sm font-semibold text-ink">{w.label}</div>
            <div className="text-xs text-faint">{WITNESS_SUB[w.id]}</div>
            <div className="mt-3 space-y-3">
              {w.statements.map((s) => {
                const r = board.rulings[s.id];
                return (
                  <div key={s.id} className={cn("rounded-2xl border p-4", r ? VERDICT[r.verdict].ring : "border-line bg-panel")}>
                    {r && <Badge verdict={r.verdict} exact={r.exact} />}
                    <p className="mt-2 text-sm leading-relaxed text-ink">{s.text}</p>
                    {r && r.verdict !== "unclear" && <p className="mt-2 text-xs leading-relaxed text-muted">{rulingLine(r, textOf(r.evidence))}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

export function FactCheckTab({ proposalId }: { proposalId: string }) {
  const { board, error } = useFactCheck(proposalId);
  const [focus, setFocus] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  useEffect(() => {
    setPinned(null);
    setFocus(null);
  }, [proposalId]);

  if (error) return <p className="rounded-[24px] border border-caution/40 bg-caution/10 px-6 py-5 text-caution">The fact-check couldn&apos;t run: {error}</p>;
  if (!board) return <CrossExamining />;
  if (!board.model)
    return <p className="rounded-[24px] border border-line bg-panel p-8 text-lg text-muted">The fact-check model isn&apos;t available on this server yet. Restart it with <span className="font-code text-sm">NODE_OPTIONS=--use-system-ca</span> so it can download the model once.</p>;

  const docs = board.witnesses.filter((w) => w.id !== "code").flatMap((w) => w.statements);
  const all = board.witnesses.flatMap((w) => w.statements);
  const count = (v: Verdict) => docs.filter((s) => board.rulings[s.id]?.verdict === v).length;
  const selected = all.find((s) => s.id === (pinned ?? focus));
  const selRuling = selected ? board.rulings[selected.id] : undefined;
  const evidenceText = (id?: string) => all.find((s) => s.id === id)?.text;

  return (
    <div className="space-y-6">
      <Rise>
        <div className="grid gap-6 rounded-[24px] border border-line bg-panel p-6 sm:p-8 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
          <div className="flex gap-8">
            {(["contradicted", "supported", "unclear"] as const).map((v) => (
              <div key={v}>
                <NumberTicker value={count(v)} className={cn("text-5xl font-semibold tracking-tight", count(v) ? VERDICT[v].text : "text-faint")} />
                <div className="mt-1 text-sm text-muted">{v === "contradicted" ? "claims caught" : v === "supported" ? "confirmed by the code" : "can't be settled"}</div>
              </div>
            ))}
          </div>
          <div className="lg:border-l lg:border-line lg:pl-8">
            <p className="text-[15px] leading-relaxed text-ink">
              We pulled {docs.length} claims out of {board.witnesses.length - 1} sources and checked each one against what the code really does. The judge is a small AI model trained for one job only: deciding whether two sentences agree or contradict. No chatbot wrote these verdicts.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
              <span className="chip !py-1">
                <Sparkles className="h-3 w-3" /> DeBERTa-v3 NLI
              </span>
              <span>runs on this server · {(board.ms / 1000).toFixed(1)} s</span>
            </div>
          </div>
        </div>
      </Rise>

      <NightPanel className="hidden md:block">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-faint">
          <span>Hover a sentence to follow its string. Click to pin it.</span>
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: CAUGHT }} /> contradicts</span>
            <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t border-dashed border-ice/60" /> agrees</span>
          </span>
        </div>
        <WitnessBoard board={board} focus={focus} setFocus={setFocus} pinned={pinned} setPinned={setPinned} />
        <div className="mt-4 min-h-[76px] rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <p className="text-[15px] leading-relaxed text-ink">&ldquo;{selected.text}&rdquo;</p>
                <p className={cn("mt-1.5 text-sm", selRuling ? VERDICT[selRuling.verdict].text : "text-evidence")}>
                  {selRuling ? rulingLine(selRuling, evidenceText(selRuling.evidence)) : "This is the code's own testimony: what happened when we ran the proposal on a copy of the chain."}
                </p>
              </motion.div>
            ) : (
              <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-faint">
                Each red string ties a claim to the line of code that disproves it.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </NightPanel>
      <div className="md:hidden">
        <WitnessList board={board} />
      </div>

      <LieBox proposalId={proposalId} board={board} />
    </div>
  );
}
