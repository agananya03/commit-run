"use client";

import { motion } from "framer-motion";
import { CheckCircle2, CircleHelp, Quote, Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { Citation } from "@/components/Citation";
import { AskWatchdog } from "@/components/AskWatchdog";
import { GlowBar, Rise } from "@/components/fx/Motion";
import { NightPanel } from "@/components/proposal/TabNav";
import type { Claim, DecisionSummary } from "@/types/shared";

const SUPPORT: Record<Claim["support"], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  supported: { label: "Backed by sources", cls: "bg-verified/10 text-verified border-verified/30", Icon: CheckCircle2 },
  unsupported: { label: "No proof found", cls: "bg-caution/10 text-caution border-caution/30", Icon: CircleHelp },
  contradicted: { label: "Sources disagree", cls: "bg-caution/15 text-caution border-caution/50", Icon: Split },
};

const usd = (v: number) => `$${v.toLocaleString("en-US")}`;

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[24px] border border-line bg-panel p-6 sm:p-8", className)}>{children}</div>;
}

export function OverviewTab({ proposalId, summary, isLoading }: { proposalId: string; summary: DecisionSummary | null; isLoading: boolean }) {
  if (isLoading) return <div className="h-72 animate-pulse rounded-[24px] bg-panel" />;
  if (!summary) {
    return (
      <Card>
        <p className="text-lg text-muted">The watchdog hasn&apos;t summarised this proposal yet.</p>
      </Card>
    );
  }
  const t = summary.treasuryImpact;
  const counts = { supported: 0, unsupported: 0, contradicted: 0 };
  for (const c of summary.claims) counts[c.support]++;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Rise>
          <Card className="h-full">
            <div className="flex items-center gap-2 text-xs font-medium text-faint">
              <Quote className="h-3.5 w-3.5" /> In plain words · written by AI, check the sources
            </div>
            <p className="mt-4 text-[clamp(20px,1.8vw,26px)] leading-snug tracking-tight text-ink">{summary.tldr}</p>
          </Card>
        </Rise>

        <Rise delay={0.1}>
          <Card className="h-full">
            <div className="text-xs font-medium text-faint">Money asked for</div>
            <div className="mt-3 text-[clamp(30px,3vw,44px)] font-semibold tracking-tight text-ink">{t.amountUsd ? usd(t.amountUsd) : "Nothing"}</div>
            <div className="mt-1 text-sm text-muted">{t.pctOfTreasury !== null ? `${t.pctOfTreasury}% of the $20M treasury` : "No treasury funds requested"}</div>
            <GlowBar value={(t.pctOfTreasury ?? 0) / 100} color={(t.pctOfTreasury ?? 0) >= 20 ? "#B392FF" : "#A78BFA"} className="mt-4" />
            {t.recipients.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-1.5">
                {t.recipients.map((r) => (
                  <span key={r} className="rounded-full bg-canvas px-3 py-1 text-xs text-ink">
                    → {r}
                  </span>
                ))}
              </div>
            )}
            {t.citations.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {t.citations.map((c, i) => (
                  <Citation key={i} citation={c} index={i + 1} />
                ))}
              </div>
            )}
          </Card>
        </Rise>
      </div>

      <Rise>
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-faint">What the proposal claims</div>
              <h3 className="mt-2 text-2xl font-medium tracking-tight text-ink">
                {summary.claims.length} claims, checked against the sources
              </h3>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {(Object.keys(counts) as Claim["support"][]).filter((k) => counts[k] > 0).map((k) => (
                <span key={k} className={cn("rounded-full border px-3 py-1 font-medium", SUPPORT[k].cls)}>
                  {counts[k]} {SUPPORT[k].label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>

          <ul className="mt-6 divide-y divide-line">
            {summary.claims.map((c, i) => {
              const s = SUPPORT[c.support];
              return (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-5% 0px" }}
                  transition={{ duration: 0.5, delay: i * 0.06 }}
                  className="grid gap-3 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start"
                >
                  <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", s.cls)}>
                    <s.Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </span>
                  <div>
                    {/* div, not p: the citation's hover card renders block elements */}
                    <div className="text-[15px] leading-relaxed text-ink">
                      {c.text}{" "}
                      {c.citations.map((ct, ci) => (
                        <Citation key={ci} citation={ct} className="ml-1 align-middle" />
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-faint">{Math.round(c.pSupported * 100)}% sure</p>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </Card>
      </Rise>

      {(summary.risks.length > 0 || summary.dependencies.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          {[
            { title: "Worth knowing", items: summary.risks, empty: "Nothing flagged." },
            { title: "Depends on", items: summary.dependencies, empty: "Nothing else." },
          ].map((block, bi) => (
            <Rise key={block.title} delay={bi * 0.1}>
              <Card className="h-full">
                <div className="text-xs font-medium text-faint">{block.title}</div>
                {block.items.length === 0 ? (
                  <p className="mt-3 text-muted">{block.empty}</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {block.items.map((it, i) => (
                      <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                        <span className="mt-2.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-evidence" />
                        <span>
                          {it.text}{" "}
                          {it.citations.map((ct, ci) => (
                            <Citation key={ci} citation={ct} className="ml-1 align-middle" />
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </Rise>
          ))}
        </div>
      )}

      <Rise>
        <div className="mb-3 mt-4 text-xs font-medium text-faint">Still unsure? Ask about this proposal. Answers only use the sources.</div>
        <NightPanel>
          <AskWatchdog proposalId={proposalId} />
        </NightPanel>
      </Rise>
    </div>
  );
}
