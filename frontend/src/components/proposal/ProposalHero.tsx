"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Check, Copy, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { shortAddr, TONE_BG, TONE_TEXT, type RadarRow } from "@/lib/radar";
import { CHECKS, checkTone, type Verdict } from "@/lib/plain";
import { ParticleField } from "@/components/fx/ParticleField";
import { Magnetic, RevealLines, Rise, RiskRing } from "@/components/fx/Motion";
import type { ReverifyResult, WatchdogFlag } from "@/types/shared";

const EASE = [0.22, 1, 0.36, 1] as const;
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";

/** Which tab answers each of the four checks. */
export const CHECK_TAB: Record<string, string> = { claims: "summary", coi: "conflicts", voting: "risk", execution: "execution" };

function CheckDots({ row, onSelectTab, dark }: { row: RadarRow; onSelectTab: (t: string) => void; dark?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHECKS.map((c) => {
        const t = checkTone(row, c.stage);
        return (
          <button
            key={c.stage}
            onClick={() => onSelectTab(CHECK_TAB[c.stage]!)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-200 hover:-translate-y-0.5",
              dark ? "border-ice/20 bg-white/5 text-ice-light/85 hover:border-ice/50" : "border-line bg-panel text-muted hover:border-ink/25 hover:text-ink",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", TONE_BG[t], t === "muted" && "opacity-40")} />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** Calm verdict card: what it is, how risky, why, in one glance. */
function VerdictHero({ row, verdict, onSelectTab }: { row: RadarRow; verdict: Verdict; onSelectTab: (t: string) => void }) {
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-line bg-panel px-6 py-9 shadow-[0_30px_90px_-50px_rgba(0,0,0,0.45)] sm:px-12 sm:py-12">
      <div aria-hidden className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-evidence/10 blur-[90px]" />
      <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="eyebrow !text-evidence">
            {row.slug} · {verdict.status}
          </div>
          <h1 className="mt-4 max-w-[22ch] text-[clamp(34px,4.6vw,64px)] font-medium leading-[1.02] tracking-[-0.035em] text-ink">
            <RevealLines lines={[row.title]} />
          </h1>
          <Rise delay={0.25}>
            <p className={cn("mt-6 text-[clamp(22px,2.2vw,30px)] font-semibold tracking-tight", TONE_TEXT[verdict.tone])}>{verdict.word}.</p>
            <p className="mt-2 max-w-[48ch] text-lg leading-relaxed text-muted">{verdict.why}</p>
          </Rise>
          <Rise delay={0.4} className="mt-8">
            <CheckDots row={row} onSelectTab={onSelectTab} />
          </Rise>
        </div>
        <Rise delay={0.2} className="justify-self-center">
          <RiskRing value={row.posterior} tone={verdict.tone} size={190} label="risk" />
        </Rise>
      </div>
    </section>
  );
}

/** The intercept: abrupt stamp, the execution gate closing, then a calm, readable incident receipt. */
function IncidentHero({ row, verdict, flag, onSelectTab }: { row: RadarRow; verdict: Verdict; flag: WatchdogFlag; onSelectTab: (t: string) => void }) {
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const [overrule, setOverrule] = useState(false);
  const [check, setCheck] = useState<{ state: "idle" | "running" | "done"; result?: ReverifyResult }>({ state: "idle" });

  const steps = [
    { label: "Problem found", detail: `${row.findingCount} finding${row.findingCount === 1 ? "" : "s"} in the queued code` },
    { label: "Freeze sent", detail: `GovernanceGuard.flag · ${shortAddr(flag.txHash)}` },
    { label: "Freeze confirmed", detail: `on-chain in block ${flag.blockNumber.toLocaleString("en-US")}` },
  ];

  const recheck = async () => {
    setCheck({ state: "running" });
    const result = await api.reverifyProposal(row.slug);
    setCheck({ state: "done", result });
  };

  return (
    <section className="relative isolate overflow-hidden rounded-[32px] bg-night px-6 py-9 text-ice-light shadow-[0_40px_120px_-40px_rgba(167,139,250,0.45)] sm:px-12 sm:py-12">
      <div aria-hidden className="motion-safe-only absolute -right-32 -top-40 h-[520px] w-[520px] animate-drift rounded-full bg-danger/30 blur-[120px]" />
      <div aria-hidden className="motion-safe-only absolute -bottom-48 -left-24 h-[460px] w-[460px] animate-drift-slow rounded-full bg-indigo/20 blur-[120px]" />
      <ParticleField count={36} color="167, 139, 250" />

      <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="eyebrow !text-[#a78bfa]">{row.slug} · incident</div>
          <motion.h1
            initial={reduce ? false : { opacity: 0, scale: 1.18, letterSpacing: "0.04em" }}
            animate={{ opacity: 1, scale: 1, letterSpacing: "-0.045em" }}
            transition={{ duration: 0.55, ease: [0.2, 0.9, 0.1, 1] }}
            className="danger-text mt-3 origin-left text-[clamp(64px,10vw,150px)] font-semibold leading-[0.9]"
          >
            STOPPED.
          </motion.h1>
          {/* the execution gate closing */}
          <motion.div
            aria-hidden
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.45, delay: 0.45, ease: EASE }}
            className="mt-4 h-1 origin-left rounded-full bg-danger shadow-[0_0_24px_#b392ff]"
          />
          <Rise delay={0.7}>
            <p className="mt-7 max-w-[46ch] text-[clamp(17px,1.4vw,20px)] leading-relaxed text-ice-light/80">
              <span className="font-medium text-white">{row.title}</span> passed its vote, but the code {verdict.why.charAt(0).toLowerCase() + verdict.why.slice(1)} The watchdog froze it before it could run.
            </p>
          </Rise>

          <ol className="mt-8 grid gap-3 sm:grid-cols-3">
            {steps.map((s, i) => (
              <motion.li
                key={s.label}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.9 + i * 0.22, ease: EASE }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-danger/90">
                    <Check className="h-3 w-3" />
                  </span>
                  {s.label}
                </div>
                <div className="mt-1 font-code text-[11px] text-ice-light/60">{s.detail}</div>
              </motion.li>
            ))}
          </ol>

          <Rise delay={1.5} className="mt-8 flex flex-wrap items-center gap-3">
            <Magnetic>
              <button onClick={recheck} disabled={check.state === "running"} className="pill-cta pill-ice">
                <RefreshCw className={cn("h-4 w-4", check.state === "running" && "animate-spin")} />
                {check.state === "running" ? "Re-checking…" : "Re-check everything"}
              </button>
            </Magnetic>
            <button onClick={() => setOverrule((o) => !o)} className="rounded-full px-4 py-3 text-sm text-ice-light/75 underline-offset-4 hover:text-white hover:underline">
              Can token holders overrule this?
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(flag.txHash);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-3 font-code text-[11px] text-ice-light/55 hover:text-white"
              title="Copy the freeze transaction hash"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} receipt {shortAddr(flag.txHash)}
            </button>
          </Rise>

          {check.state === "done" && check.result && (
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 max-w-[60ch] text-sm text-ice-light/80">
              {check.result.allMatch ? "Everything matches: " : "Something differs: "}
              sources {check.result.versions.every((v) => v.match) ? "✓" : "✗"}, simulation {check.result.simMatch ? "✓" : "✗"}, findings {check.result.findingsMatch ? "✓" : "✗"}.
              {USE_MOCKS && <span className="ml-2 font-code text-[11px] text-caution">demo result</span>}
            </motion.p>
          )}
          {overrule && (
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 max-w-[60ch] text-sm leading-relaxed text-ice-light/80">
              Yes. The watchdog can only pause, never decide. Token holders can pass a new proposal that calls{" "}
              <code className="font-code text-ice">GovernanceGuard.clear()</code> for this operation; once that vote executes, {row.slug} can run. A cleared
              freeze can&apos;t be applied again.
            </motion.p>
          )}
        </div>

        <div className="flex flex-col items-center gap-6 justify-self-center">
          <Rise delay={0.3}>
            <RiskRing value={row.posterior} tone="danger" size={190} label="risk" />
          </Rise>
          <Rise delay={0.6}>
            <CheckDots row={row} onSelectTab={onSelectTab} dark />
          </Rise>
        </div>
      </div>
    </section>
  );
}

export function ProposalHero({ row, verdict, flag, onSelectTab }: { row: RadarRow; verdict: Verdict; flag: WatchdogFlag | null; onSelectTab: (t: string) => void }) {
  return flag ? <IncidentHero row={row} verdict={verdict} flag={flag} onSelectTab={onSelectTab} /> : <VerdictHero row={row} verdict={verdict} onSelectTab={onSelectTab} />;
}
