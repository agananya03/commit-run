"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Check, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEvidencePanel } from "@/components/EvidencePanel";
import { CAUGHT } from "@/components/proposal/factcheckLook";
import type { Passage } from "@/lib/chat/server";
import type { SentenceCheck } from "@/lib/verify/answer";

const SOURCE: Record<NonNullable<SentenceCheck["evidence"]>["source"], string> = {
  code: "What the code does (simulation)",
  watchdog: "The watchdog's record",
  finding: "A watchdog finding",
  passage: "Source document",
};

const LOOK = {
  grounded: { title: "Backed by the evidence", color: "#C4B5FD" },
  contradicted: { title: "The evidence says otherwise", color: CAUGHT },
  unverified: { title: "No single source says this", color: "#6F6C8C" },
} as const;

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

const CARD_W = 300;

/** The small mark after each sentence of an answer; hover (or focus) shows the evidence the NLI model ruled with. */
export function SentenceBadge({ check, passages }: { check: SentenceCheck; passages: Passage[] }) {
  const { openCitation } = useEvidencePanel();
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const look = LOOK[check.verdict];
  const ev = check.evidence;
  const passage = ev?.passageId ? passages.find((p) => p.id === ev.passageId) : undefined;

  // the chat panel is transformed, so the card is portalled to <body> and kept inside the viewport
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.top > 240;
    setPos({ left: Math.max(8, Math.min(r.left - 12, window.innerWidth - CARD_W - 8)), top: above ? r.top - 8 : r.bottom + 8, above });
  };
  const hide = () => {
    timer.current = setTimeout(() => setPos(null), 120);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <>
      <motion.button
        ref={btn}
        type="button"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 18 }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => passage && openCitation({ chunkId: passage.id, sha256: passage.sha256 as `0x${string}`, quote: passage.text, sourceUri: passage.sourceUri })}
        className={cn(
          "mx-0.5 inline-flex h-[15px] w-[15px] items-center justify-center rounded-full align-[-2px] outline-none focus-visible:ring-2 focus-visible:ring-evidence/50",
          check.verdict === "unverified" ? "border border-dashed border-faint/70" : "",
        )}
        style={check.verdict === "unverified" ? undefined : { background: `${look.color}26`, boxShadow: `inset 0 0 0 1px ${look.color}99` }}
        aria-label={look.title}
      >
        {check.verdict === "grounded" && <Check className="h-2.5 w-2.5" strokeWidth={3} style={{ color: look.color }} />}
        {check.verdict === "contradicted" && <X className="h-2.5 w-2.5" strokeWidth={3} style={{ color: look.color }} />}
      </motion.button>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            onMouseEnter={show}
            onMouseLeave={hide}
            className="fixed z-[80] block space-y-2 rounded-xl border border-white/10 bg-[#100F22] p-3 text-xs shadow-2xl"
            style={{ left: pos.left, top: pos.top, width: CARD_W, transform: pos.above ? "translateY(-100%)" : undefined }}
          >
            <Card check={check} passageOpen={!!passage} />
          </span>,
          document.body,
        )}
    </>
  );
}

function Card({ check, passageOpen }: { check: SentenceCheck; passageOpen: boolean }) {
  const look = LOOK[check.verdict];
  const ev = check.evidence;
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold" style={{ color: look.color }}>
          {look.title}
        </span>
        {check.verdict !== "unverified" && <span className="text-[10px] text-faint">model {pct(check.score)} sure</span>}
      </span>
      {ev ? (
        <>
          <span className="block rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5 text-[11px] leading-relaxed text-ink/90">&ldquo;{ev.text.length > 260 ? `${ev.text.slice(0, 257)}…` : ev.text}&rdquo;</span>
          <span className="block text-[10px] text-faint">
            {check.verdict === "unverified" ? "Closest evidence · " : ""}
            {SOURCE[ev.source]} · {ev.proposalId}
            {passageOpen && <span className="text-evidence"> · click the mark to open it</span>}
          </span>
        </>
      ) : (
        <span className="block text-[11px] leading-relaxed text-muted">Nothing in the code, the findings or the sources states this directly. It may be a fair summary, but it isn&apos;t verified.</span>
      )}
    </>
  );
}

/** One line under the answer: how many sentences the NLI model could back up. */
export function VerifySummary({ checks, checking, model }: { checks: SentenceCheck[]; checking: boolean; model?: string }) {
  const n = (v: SentenceCheck["verdict"]) => checks.filter((c) => c.verdict === v).length;
  if (checking && !checks.length)
    return (
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-faint">
        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}>
          <ShieldCheck className="h-3.5 w-3.5 text-evidence" />
        </motion.span>
        Checking each sentence against the evidence…
      </div>
    );
  if (!checks.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint" title={model ? `Checked by ${model}, running on this server` : undefined}>
      <ShieldCheck className="h-3.5 w-3.5 text-evidence" />
      <span>
        <span className="text-ice">{n("grounded")}</span> of {checks.length} sentences backed by evidence
      </span>
      {n("contradicted") > 0 && (
        <span style={{ color: CAUGHT }}>
          · {n("contradicted")} contradicted
        </span>
      )}
      <span>· checked by an NLI model, not the chatbot{checking ? "…" : ""}</span>
    </div>
  );
}
