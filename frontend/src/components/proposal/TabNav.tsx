"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export const PROPOSAL_TABS = [
  { id: "summary", label: "Overview" },
  { id: "execution", label: "Promise vs code" },
  { id: "conflicts", label: "Money trail" },
  { id: "risk", label: "Risk score" },
  { id: "evidence", label: "Sources" },
  { id: "timeline", label: "History" },
] as const;

export type ProposalTab = (typeof PROPOSAL_TABS)[number]["id"];

/** Sticky pill bar under the status strip; the active pill slides between tabs. Keys 1-6 also switch. */
export function TabNav({ active, onChange, alerts = {} }: { active: string; onChange: (t: ProposalTab) => void; alerts?: Partial<Record<ProposalTab, boolean>> }) {
  return (
    <div className="no-print sticky top-11 z-20 -mx-4 bg-canvas/80 px-4 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
      <nav className="rf-card flex gap-1 overflow-x-auto rounded-2xl border border-white/[0.07] bg-panel/80 p-1.5 [scrollbar-width:none]">
        {PROPOSAL_TABS.map((t, i) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={cn(
                "relative flex-shrink-0 rounded-xl px-4 py-2 text-sm font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-evidence/40",
                isActive ? "text-white" : "text-muted hover:text-ink",
              )}
              title={`${t.label} (${i + 1})`}
            >
              {isActive && (
                <motion.span
                  layoutId="proposal-tab-pill"
                  className="absolute inset-0 rounded-xl border border-indigo/50 bg-gradient-to-b from-[#3a2580] to-[#261759] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative flex items-center gap-2">
                {t.label}
                {alerts[t.id] && <span className="h-1.5 w-1.5 rounded-full bg-danger" />}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** Section header in the page's editorial style: eyebrow, big title, one plain sentence. */
export function SectionHead({ eyebrow, title, line }: { eyebrow: string; title: string; line: string }) {
  return (
    <div className="mb-8 mt-4">
      <div className="eyebrow !text-evidence">{eyebrow}</div>
      <h2 className="mt-3 text-[clamp(30px,3.6vw,52px)] font-medium leading-[1.05] tracking-[-0.035em] text-ink">{title}</h2>
      <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-muted">{line}</p>
    </div>
  );
}

/** A dark rounded window (the intro's look) that hosts the detailed, data-dense views. */
export function NightPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rf-card relative overflow-hidden rounded-[24px] border border-white/[0.07] bg-night p-3 sm:p-5", className)}>{children}</div>;
}
