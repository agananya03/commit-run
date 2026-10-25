"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Printer, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { IngestProposalDialog } from "@/components/IngestProposalDialog";
import { useRadarRows } from "@/lib/useRadar";
import { TONE_BG, toneOf } from "@/lib/radar";

/** Hover label for a rail item (the rail itself stays icon-narrow). */
function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-x-1 -translate-y-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-raised px-3 py-1.5 text-xs text-ink opacity-0 shadow-xl transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
      {children}
    </span>
  );
}

const itemClass = (active: boolean) =>
  cn(
    "group relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-200",
    active
      ? "border-indigo/50 bg-gradient-to-b from-[#3a2580] to-[#261759] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
      : "border-transparent text-muted hover:border-white/10 hover:bg-white/[0.04] hover:text-ink",
  );

/** Fixed narrow rail: radar, one chip per proposal (live severity), ingest, export. */
export function NavRail() {
  const pathname = usePathname();
  const [ingestOpen, setIngestOpen] = useState(false);
  const { rows } = useRadarRows();

  return (
    <aside className="no-print sidebar fixed inset-y-0 left-0 z-40 flex w-16 flex-col items-center justify-between border-r border-white/[0.06] bg-canvas/80 py-4 backdrop-blur-xl select-none">
      <div className="flex flex-col items-center gap-2.5">
        <Link href="/" className="group relative mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-indigo/40 bg-gradient-to-b from-[#4c2fa3] to-[#2a1b5c] shadow-[0_0_20px_-4px_rgba(139,92,246,0.6)]">
          <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_10px_#c4b5fd]" />
          <RailLabel>ProofOfIntent · replay the intro</RailLabel>
        </Link>

        <Link href="/dashboard" className={itemClass(pathname === "/dashboard")}>
          <Radar className="h-4 w-4" />
          <RailLabel>All proposals</RailLabel>
        </Link>

        <div className="my-1 h-px w-6 bg-line" />

        {rows.map((r) => (
          <Link key={r.slug} href={`/proposals/${r.slug}`} className={itemClass(pathname === `/proposals/${r.slug}`)}>
            <span className="font-code text-[11px] font-semibold">{r.slug.replace(/^[A-Z]+-/, "")}</span>
            <span className={cn("absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-canvas", TONE_BG[toneOf(r.level)])} />
            <RailLabel>{r.title}</RailLabel>
          </Link>
        ))}

        <button onClick={() => setIngestOpen(true)} className={itemClass(false)} aria-label="Add a proposal">
          <Plus className="h-4 w-4" />
          <RailLabel>Add a proposal</RailLabel>
        </button>
      </div>

      <button onClick={() => window.print()} className={itemClass(false)} aria-label="Export report">
        <Printer className="h-4 w-4" />
        <RailLabel>Print / save as PDF</RailLabel>
      </button>

      <IngestProposalDialog open={ingestOpen} onOpenChange={setIngestOpen} />
    </aside>
  );
}
