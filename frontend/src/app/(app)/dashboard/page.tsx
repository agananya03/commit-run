"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowRight, Code2, FileText, Network, Sparkles, Vote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRadarRows } from "@/lib/useRadar";
import { TONE_BG, TONE_TEXT, type RadarRow } from "@/lib/radar";
import { CHECKS, checkTone, verdictOf } from "@/lib/plain";
import { ParticleField } from "@/components/fx/ParticleField";
import { BorderBeam } from "@/components/fx/BorderBeam";
import { Magnetic, RevealLines, Rise, RiskRing, TiltCard } from "@/components/fx/Motion";

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

/* ---------------------------------------------------------------- 1. hero window */

function Hero({ rows }: { rows: RadarRow[] }) {
  const stopped = rows.filter((r) => r.state === "HALTED");
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 600], [0, -80]);
  const fade = useTransform(scrollY, [0, 500], [1, 0.2]);

  const lead = stopped[0] ?? rows[0];
  const leadVerdict = lead ? verdictOf(lead) : null;

  return (
    <section className="relative isolate -mx-4 -mt-4 flex min-h-[calc(100vh-3rem)] flex-col items-center overflow-hidden px-4 pt-[12vh] text-center sm:-mx-8 sm:px-8">
      {/* faint starfield, and one violet light rising from below (after reflect.app) */}
      <ParticleField count={60} />
      {/* perspective grid floor gliding toward the viewer; no translate classes, its transform is the perspective */}
      <div aria-hidden className="grid-floor pointer-events-none absolute bottom-[-18%] left-[-30%] h-[48%] w-[160%] opacity-60" />
      <div aria-hidden className="violet-glow pointer-events-none absolute bottom-[-14%] left-1/2 h-[460px] w-[min(900px,110vw)] -translate-x-1/2" />

      <motion.div style={{ y, opacity: fade }} className="relative flex flex-col items-center">
        <Rise>
          <span className="chip">
            <Sparkles className="h-3.5 w-3.5 text-ice" /> Meridian DAO governance watchdog
          </span>
        </Rise>
        <h1 className="mt-7 text-[clamp(44px,6.4vw,92px)] font-medium leading-[1.04] tracking-[-0.035em]">
          <RevealLines
            lines={[
              // a live count of what the watchdog is tracking right now, not a claim about all proposals
              <span key="a" className="ice-text inline-block pr-[0.04em]">
                {rows.length || "—"} {rows.length === 1 ? "proposal" : "proposals"} watched.
              </span>,
              stopped.length > 0 ? (
                <span key="b" className="danger-text inline-block pr-[0.04em]">{stopped.length} stopped.</span>
              ) : (
                <span key="b" className="ice-text inline-block pr-[0.04em]">All clear.</span>
              ),
            ]}
          />
        </h1>
        <Rise delay={0.3}>
          <p className="mt-6 max-w-[44ch] text-[clamp(16px,1.3vw,19px)] leading-relaxed text-muted">
            We read every proposal, run its code, and freeze it if the two don&apos;t match.
          </p>
        </Rise>
        <Rise delay={0.45} className="mt-9 flex flex-wrap justify-center gap-3">
          <Magnetic strength={0.15}>
            {stopped[0] ? (
              <Link href={`/proposals/${stopped[0].slug}`} className="pill-cta pill-danger">
                See what we stopped
              </Link>
            ) : (
              <a href="#proposals" className="pill-cta pill-danger">
                Browse proposals
              </a>
            )}
          </Magnetic>
          <Magnetic strength={0.15}>
            <a href="#how" className="pill-cta pill-ice">
              How it works
            </a>
          </Magnetic>
        </Rise>
        <Rise delay={0.55}>
          <p className="mt-4 text-sm text-faint">
            {stopped.length ? `${stopped.length} frozen at the timelock` : "No proposal frozen right now"} · {USE_MOCKS ? "demo data: added proposals aren't saved" : "live from the chain"}
          </p>
        </Rise>
      </motion.div>

      {/* a glimpse of the product, emerging from the light */}
      {lead && leadVerdict && (
        <Rise delay={0.7} className="relative mt-auto w-full max-w-[560px] translate-y-6">
          <Link href={`/proposals/${lead.slug}`} className="glass rf-card block rounded-t-[22px] border-b-0 px-6 pb-10 pt-5 text-left transition-colors hover:border-white/20">
            <div className="flex items-center justify-between text-sm">
              <span className="font-code text-xs text-muted">{lead.slug}</span>
              <span className="text-faint">{leadVerdict.status}</span>
            </div>
            <div className="mt-3 text-lg font-medium text-ink">{lead.title}</div>
            <div className={cn("mt-1 text-sm", TONE_TEXT[leadVerdict.tone])}>
              {leadVerdict.word}: {leadVerdict.why.charAt(0).toLowerCase() + leadVerdict.why.slice(1)}
            </div>
          </Link>
        </Rise>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- 2. statement with self-drawing line */

function Statement() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.9", "end 0.3"] });
  const draw = useTransform(scrollYProgress, [0, 1], [0, 1]);

  return (
    <section ref={ref} className="relative overflow-hidden py-28 sm:py-40">
      <svg aria-hidden viewBox="0 0 1200 520" className="pointer-events-none absolute inset-x-0 top-1/2 z-0 h-[120%] w-full -translate-y-1/2" preserveAspectRatio="none">
        <motion.path
          d="M 380 560 C 520 300, 700 120, 820 260 S 980 520, 1080 300 S 1180 60, 1260 140"
          fill="none"
          stroke="#8B5CF6"
          strokeOpacity="0.4"
          strokeWidth="12"
          strokeLinecap="round"
          style={{ pathLength: draw }}
        />
      </svg>
      <div className="relative z-10">
        <h2 className="text-[clamp(44px,7.4vw,120px)] font-medium leading-[0.98] tracking-[-0.04em] text-ink">
          <RevealLines lines={["Read the promise.", "Run the code.", <span key="c" className="text-evidence">Stop the gap.</span>]} />
        </h2>
        <Rise delay={0.3}>
          <p className="mt-10 max-w-[46ch] text-lg leading-relaxed text-muted">
            A proposal can say one thing while its code does another. We check both, before anyone&apos;s money moves.
          </p>
        </Rise>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- 3. proposal cards */

function ProposalCard({ row, index }: { row: RadarRow; index: number }) {
  const v = verdictOf(row);
  const stopped = row.state === "HALTED";
  return (
    <Rise delay={index * 0.12}>
      <TiltCard className={cn("h-full rounded-[28px]", stopped && "shadow-[0_30px_80px_-30px_rgba(167,139,250,0.45)]")}>
        <div className={cn("relative flex h-full flex-col rounded-[28px] border bg-panel p-7", stopped ? "border-danger/30" : "border-line")}>
          {stopped && <BorderBeam color="#B392FF" size={180} />}
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-canvas px-3 py-1 font-code text-xs font-semibold text-ink">{row.slug}</span>
            <span className="text-xs text-faint">{v.status}</span>
          </div>

          <h3 className="mt-5 line-clamp-2 min-h-[3.2rem] text-lg font-medium leading-snug text-ink">{row.title}</h3>

          <div className="mt-6 flex items-center gap-6">
            <RiskRing value={row.posterior} tone={v.tone} label="risk" />
            <div className="min-w-0">
              <div className={cn("text-[28px] font-semibold leading-tight tracking-tight", TONE_TEXT[v.tone])}>{v.word}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{v.why}</p>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-4 gap-2 border-t border-line pt-5">
            {CHECKS.map((c) => {
              const t = checkTone(row, c.stage);
              return (
                <div key={c.stage} className="flex flex-col items-center gap-1.5 text-center">
                  <span className={cn("h-2.5 w-2.5 rounded-full", TONE_BG[t], t === "muted" && "opacity-40")} />
                  <span className="text-[11px] text-muted">{c.label}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-7 flex flex-1 items-end">
            <Magnetic strength={0.2}>
              <Link
                href={`/proposals/${row.slug}`}
                className={cn(
                  "inline-flex items-center gap-3 rounded-full px-5 py-3 text-sm font-medium shadow-sm transition-colors duration-200",
                  stopped ? "bg-night text-ice-light hover:bg-night-soft" : "border border-line bg-panel text-ink hover:border-ink/30",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", stopped ? "bg-danger" : "bg-ink")} />
                Investigate
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Magnetic>
          </div>
        </div>
      </TiltCard>
    </Rise>
  );
}

function Proposals({ rows, isLoading, error }: { rows: RadarRow[]; isLoading: boolean; error: Error | null }) {
  return (
    <section id="proposals" className="scroll-mt-20 py-10">
      <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="eyebrow !text-evidence">The proposals</div>
          <h2 className="mt-4 text-[clamp(36px,5vw,72px)] font-medium leading-none tracking-[-0.04em] text-ink">
            <RevealLines lines={["What's being voted on,", <span key="b" className="text-faint">and what it really does.</span>]} />
          </h2>
        </div>
      </div>
      {error && <p className="rounded-2xl border border-caution/40 bg-caution/10 px-5 py-4 text-sm text-caution">Couldn&apos;t load proposals: {error.message}</p>}
      <div className="grid gap-6 [perspective:1400px] md:grid-cols-2 xl:grid-cols-3">
        {isLoading && [0, 1, 2].map((i) => <div key={i} className="h-[440px] animate-pulse rounded-[28px] bg-panel" />)}
        {rows.map((row, i) => (
          <ProposalCard key={row.slug} row={row} index={i} />
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- 4. how it works, lit by scroll */

const STEPS = [
  { icon: FileText, label: "Promises", q: "What did they say?", a: "We read the forum post, PDF and socials." },
  { icon: Network, label: "Connections", q: "Who's linked to whom?", a: "We follow the money between wallets." },
  { icon: Vote, label: "Votes", q: "Who decided?", a: "We check who holds the voting power." },
  { icon: Code2, label: "Code", q: "What will really happen?", a: "We run the exact code on a copy of the chain." },
];

function Step({ step, index, progress }: { step: (typeof STEPS)[number]; index: number; progress: MotionValue<number> }) {
  const at = index / (STEPS.length - 1);
  const lit = useTransform(progress, [at - 0.12, at], [0, 1]);
  const bg = useTransform(lit, [0, 1], ["#100F22", "#3A2580"]);
  const fg = useTransform(lit, [0, 1], ["#6F6C8C", "#FFFFFF"]);
  const scale = useTransform(lit, [0, 1], [0.9, 1]);
  const Icon = step.icon;
  return (
    <div className="relative flex flex-col items-start md:items-center md:text-center">
      <motion.div style={{ backgroundColor: bg, color: fg, scale }} className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-line shadow-sm">
        <Icon className="h-5 w-5" />
      </motion.div>
      <div className="mt-5 font-code text-[11px] text-faint">{step.label}</div>
      <div className="mt-2 text-xl font-medium text-ink">{step.q}</div>
      <p className="mt-2 max-w-[24ch] text-sm leading-relaxed text-muted">{step.a}</p>
    </div>
  );
}

function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.75", "end 0.55"] });
  return (
    <section ref={ref} id="how" className="scroll-mt-16 py-28 sm:py-36">
      <div className="eyebrow !text-evidence">How it works</div>
      <h2 className="mt-4 text-[clamp(36px,5vw,72px)] font-medium leading-none tracking-[-0.04em] text-ink">
        <RevealLines lines={["Four checks.", <span key="b" className="text-faint">One decision.</span>]} />
      </h2>

      <div className="relative mt-20 grid gap-12 md:grid-cols-4 md:gap-6">
        <div aria-hidden className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-px bg-white/10 md:block">
          <motion.div className="-mt-px h-[2px] origin-left rounded-full bg-gradient-to-r from-white/40 to-[#A78BFA] shadow-[0_0_10px_#a78bfa]" style={{ scaleX: scrollYProgress }} />
        </div>
        {STEPS.map((s, i) => (
          <Step key={s.label} step={s} index={i} progress={scrollYProgress} />
        ))}
      </div>

      <Rise className="mt-20">
        <div className="relative overflow-hidden rounded-[28px] bg-night px-8 py-10 text-ice-light sm:px-12">
          <div aria-hidden className="absolute -right-20 -top-24 h-72 w-72 rounded-full bg-danger/25 blur-[90px]" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <p className="text-[clamp(24px,3vw,40px)] font-semibold leading-tight tracking-tight">
              Promise and code don&apos;t match? <span className="danger-text">The vote&apos;s result is frozen.</span>
            </p>
            <span className="max-w-[30ch] text-sm leading-relaxed text-ice-light/70">
              The watchdog flags it on-chain, and only a new vote by token holders can unfreeze it.
            </span>
          </div>
        </div>
      </Rise>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function ProposalRadarPage() {
  const { rows, isLoading, error } = useRadarRows();
  return (
    <div>
      <Hero rows={rows} />
      <Statement />
      <Proposals rows={rows} isLoading={isLoading} error={error} />
      <HowItWorks />
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-faint">
        <span>
          <span className="mr-2 rounded-full border border-caution/40 bg-caution/10 px-2.5 py-0.5 font-medium text-caution">Demo data</span>
          Meridian DAO is fictional. Its proposals run on a local test chain.
        </span>
        <span className="font-code">ProofOfIntent</span>
      </footer>
    </div>
  );
}
