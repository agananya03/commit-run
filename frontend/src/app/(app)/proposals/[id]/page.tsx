"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useProposalBundle, type ProposalListItem, type WatchdogFlag } from "@/lib/api";
import { buildRow } from "@/lib/radar";
import { checkTone, verdictOf } from "@/lib/plain";
import { PromiseVsCode } from "@/components/proposal/PromiseVsCode";
import { RiskTrack } from "@/components/proposal/RiskTrack";
import { MoneyTrail } from "@/components/proposal/MoneyTrail";
import { HistoryTab } from "@/components/proposal/HistoryTab";
import { ProposalHero } from "@/components/proposal/ProposalHero";
import { OverviewTab } from "@/components/proposal/OverviewTab";
import { SourcesTab } from "@/components/proposal/SourcesTab";
import { NightPanel, PROPOSAL_TABS, SectionHead, TabNav, type ProposalTab } from "@/components/proposal/TabNav";

export default function ProposalDetailPage() {
  const params = useParams();
  const proposalId = (params?.id as string) || "MIP-21";
  const [tab, setTab] = useState<ProposalTab>("summary");
  const [liveFlag, setLiveFlag] = useState<WatchdogFlag | null>(null);
  const { data: bundle, isLoading, error } = useProposalBundle(proposalId);

  // A flag that arrives over the socket while the page is open (WatchdogGlobalListener re-dispatches it).
  useEffect(() => {
    const onFlag = (e: Event) => {
      const detail = (e as CustomEvent<WatchdogFlag>).detail;
      if (detail?.proposalId === proposalId) setLiveFlag(detail);
    };
    window.addEventListener("watchdog:flag:received", onFlag);
    return () => window.removeEventListener("watchdog:flag:received", onFlag);
  }, [proposalId]);

  // ?tab=execution (from the assistant's finding chips) opens that tab directly
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && PROPOSAL_TABS.some((x) => x.id === t)) setTab(t as ProposalTab);
  }, [proposalId]);

  // Keys 1-6 jump between tabs, ←/→ step through them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable], [role=dialog]")) return;
      const ids = PROPOSAL_TABS.map((t) => t.id);
      if (e.key >= "1" && e.key <= "6") setTab(ids[Number(e.key) - 1]!);
      else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        setTab((cur) => ids[(ids.indexOf(cur) + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const flag = liveFlag ?? bundle?.flag ?? null;
  const row = bundle
    ? buildRow({ ...bundle.proposal, status: flag ? "HALTED" : bundle.proposal.status } as ProposalListItem, flag && !bundle.flag ? { ...bundle, flag } : bundle)
    : null;
  const verdict = row ? verdictOf(row) : null;
  const latest = bundle?.versions.at(-1) ?? null;
  const select = (t: string) => {
    setTab(t as ProposalTab);
    window.scrollTo({ top: document.getElementById("proposal-tabs")?.offsetTop ?? 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full px-1 py-1 text-sm text-muted transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> All proposals
      </Link>

      {error && <p className="rounded-[24px] border border-caution/40 bg-caution/10 px-6 py-5 text-caution">Couldn&apos;t load {proposalId}: {(error as Error).message}</p>}
      {isLoading && <div className="h-[420px] animate-pulse rounded-[32px] bg-panel" />}
      {row && verdict && <ProposalHero row={row} verdict={verdict} flag={flag} onSelectTab={select} />}

      {row && !flag && row.findings.some((f) => f.severity === "critical" || f.severity === "high") && (
        <button
          onClick={() => select("execution")}
          className="group flex w-full flex-wrap items-center justify-between gap-3 rounded-[24px] border border-danger/25 bg-danger/[0.06] px-6 py-4 text-left transition-colors hover:bg-danger/10"
        >
          <span className="text-[15px] text-ink">
            <span className="font-semibold text-danger">Heads up:</span> the code does things the proposal text never mentions.
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-danger">
            See promise vs code <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      )}

      <div id="proposal-tabs" className="scroll-mt-12">
        <TabNav
          active={tab}
          onChange={setTab}
          alerts={row ? { execution: row.criticalCount > 0, conflicts: checkTone(row, "coi") === "danger" } : {}}
        />

        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="pt-4">
            {tab === "summary" && <OverviewTab proposalId={proposalId} summary={bundle?.summary ?? null} isLoading={isLoading} />}

            {tab === "execution" && (
              <>
                <SectionHead eyebrow="Promise vs code" title="What it says, next to what it does." line="Left: what the proposal promised, word for word. Right: what its code actually does when we run it on a copy of the chain." />
                <PromiseVsCode proposalId={proposalId} intent={bundle?.intent} simulation={bundle?.simulation} findings={bundle?.findings} explanation={bundle?.explanation} onSelectTab={select} />
              </>
            )}

            {tab === "conflicts" && (
              <>
                <SectionHead eyebrow="Money trail" title="Who's connected to whom." line="On the surface these wallets look unrelated. Press Reveal to see the payments the proposer didn't disclose." />
                <NightPanel>
                  <MoneyTrail proposalId={proposalId} coi={bundle?.coi} summary={bundle?.summary} findings={bundle?.findings} />
                </NightPanel>
              </>
            )}

            {tab === "risk" && (
              <>
                <SectionHead eyebrow="Risk score" title="How each check moved the risk." line="Every proposal starts at a 5% chance of being harmful. Each check pushes that up or down, until we get a final score." />
                <RiskTrack risk={bundle?.risk} findings={bundle?.findings} onSelectTab={select} />
              </>
            )}

            {tab === "evidence" && (
              <>
                <SectionHead eyebrow="Sources" title="Everything we read, fingerprinted." line="Open any source to see the exact text, with its fingerprint re-checked on the spot." />
                <SourcesTab version={latest} />
              </>
            )}

            {tab === "timeline" && (
              <>
                <SectionHead eyebrow="History" title="Every version, every on-chain step." line="Where this proposal is in its life, whether anyone quietly edited it, and each step it took on the chain, with receipts." />
                <HistoryTab proposalId={proposalId} bundle={bundle} />
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
