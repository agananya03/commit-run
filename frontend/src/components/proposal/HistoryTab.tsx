"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { Check, ChevronDown, Copy, FileDiff, Link2, Lock, Megaphone, PenLine, Play, ShieldAlert, ShieldCheck, Timer, Unlock, Vote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nameOf } from "@/lib/promiseVsCode";
import { PipelineProgress } from "@/components/PipelineProgress";
import { ProposalTimeline } from "@/components/ProposalTimeline";
import { GlowBar, Rise } from "@/components/fx/Motion";
import { NightPanel } from "@/components/proposal/TabNav";
import type { ChainEvent, ProposalBundle, ProposalVersion } from "@/types/shared";

const EASE = [0.22, 1, 0.36, 1] as const;
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const SOURCE: Record<string, string> = { pdf: "Proposal PDF", forum: "Forum thread", social: "Social posts", onchain: "On-chain actions", disclosure: "Signed disclosure" };

function CopyHash({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-canvas px-2.5 py-1 font-code text-[11px] text-muted transition-colors hover:text-ink"
      title={`Copy ${label ?? "hash"}`}
    >
      {done ? <Check className="h-3 w-3 text-verified" /> : <Copy className="h-3 w-3" />}
      {label ? `${label} ` : ""}
      {short(value)}
    </button>
  );
}

/* ------------------------------------------------------------ lifecycle (Vercel-style) */

type PhaseState = "done" | "now" | "todo" | "stopped";

function lifecycle(bundle: ProposalBundle) {
  const names = new Set(bundle.chainEvents.map((e) => e.name));
  const flagged = Boolean(bundle.flag) || names.has("Flagged");
  const cleared = names.has("Cleared");
  const ran = names.has("Executed") || names.has("ProposalExecuted") || names.has("CallExecuted") || bundle.proposal.status === "EXECUTED";
  const voted = names.has("ProposalCreated") || names.has("VoteCast");
  const queued = names.has("ProposalQueued") || names.has("CallScheduled");
  const checked = Boolean(bundle.risk);
  const steps: { label: string; state: PhaseState; Icon: typeof PenLine }[] = [
    { label: "Written", state: bundle.versions.length ? "done" : "now", Icon: PenLine },
    { label: "Voted", state: voted ? "done" : bundle.versions.length ? "now" : "todo", Icon: Vote },
    { label: "Queued", state: queued ? "done" : voted ? "now" : "todo", Icon: Timer },
    { label: "Checked", state: checked ? "done" : "todo", Icon: ShieldCheck },
    flagged && !cleared
      ? { label: "Frozen", state: "stopped", Icon: Lock }
      : { label: ran ? "Ran" : "Runs after the delay", state: ran ? "done" : queued ? "now" : "todo", Icon: Play },
  ];
  return steps;
}

function Lifecycle({ bundle }: { bundle: ProposalBundle }) {
  const steps = lifecycle(bundle);
  const reached = steps.filter((s) => s.state === "done" || s.state === "stopped").length;
  return (
    <Rise>
      <div className="rounded-[24px] border border-line bg-panel p-6 sm:p-8">
        <div className="relative grid grid-cols-5">
          <div className="absolute left-[10%] right-[10%] top-5 h-px bg-white/10" />
          <motion.div
            className="absolute left-[10%] top-5 h-[2px] origin-left rounded-full bg-gradient-to-r from-white/40 to-danger"
            style={{ width: "80%", marginTop: -0.5, boxShadow: "0 0 10px #b392ff" }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: Math.max(0, reached - 1) / 4 }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: EASE }}
          />
          {steps.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.2 + i * 0.18 }}
              className="relative flex flex-col items-center text-center"
            >
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2",
                  s.state === "done" && "border-evidence/70 bg-[#1d1442] text-white shadow-[0_0_14px_-2px_#a78bfa]",
                  s.state === "stopped" && "border-white/80 bg-[#2a1b5c] text-white shadow-[0_0_22px_0_#b392ff]",
                  s.state === "now" && "border-evidence bg-panel text-evidence",
                  s.state === "todo" && "border-line bg-panel text-faint",
                )}
              >
                <s.Icon className="h-4 w-4" />
              </span>
              <span className={cn("mt-3 text-sm font-medium", s.state === "stopped" ? "text-danger" : s.state === "todo" ? "text-faint" : "text-ink")}>{s.label}</span>
              {s.state === "now" && <span className="mt-0.5 text-[11px] text-evidence">in progress</span>}
            </motion.div>
          ))}
        </div>
      </div>
    </Rise>
  );
}

/* ------------------------------------------------------------ version chain */

function fileChanges(prev: ProposalVersion | undefined, cur: ProposalVersion) {
  if (!prev) return cur.files.map((f) => ({ label: SOURCE[f.type] ?? f.type, status: "added" as const }));
  const out: { label: string; status: "added" | "removed" | "changed" | "same" }[] = [];
  for (const f of cur.files) {
    const p = prev.files.find((x) => x.uri === f.uri || x.type === f.type);
    out.push({ label: SOURCE[f.type] ?? f.type, status: !p ? "added" : p.sha256 === f.sha256 ? "same" : "changed" });
  }
  for (const p of prev.files) if (!cur.files.some((f) => f.uri === p.uri || f.type === p.type)) out.push({ label: SOURCE[p.type] ?? p.type, status: "removed" });
  return out;
}

function VersionChain({ versions }: { versions: ProposalVersion[] }) {
  const [sel, setSel] = useState(versions.length - 1);
  if (versions.length === 0) return null;
  const v = versions[sel]!;
  const prev = sel > 0 ? versions[sel - 1] : undefined;
  const changes = fileChanges(prev, v);
  const changed = changes.filter((c) => c.status !== "same");
  const linkOk = (i: number) => i === 0 || versions[i]!.prevHash.toLowerCase() === versions[i - 1]!.versionHash.toLowerCase();

  return (
    <Rise>
      <div className="rounded-[24px] border border-line bg-panel p-6 sm:p-8">
        <div className="text-xs font-medium text-faint">Versions · each one points at the one before it, so history can&apos;t be rewritten</div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {versions.map((ver, i) => (
            <div key={ver.version} className="flex items-center gap-2">
              {i > 0 && (
                <span className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium", linkOk(i) ? "bg-verified/10 text-verified" : "bg-danger/10 text-danger")} title="prevHash matches the previous version's hash">
                  <Link2 className="h-3 w-3" />
                  {linkOk(i) ? "linked" : "broken link"}
                </span>
              )}
              <button
                onClick={() => setSel(i)}
                className={cn("rounded-2xl border px-4 py-3 text-left transition-all duration-200", sel === i ? "border-evidence bg-evidence/5 shadow-[0_12px_30px_-18px_rgba(139,92,246,0.7)]" : "border-line hover:border-ink/25")}
              >
                <div className="text-sm font-semibold text-ink">Version {ver.version}</div>
                <div className="font-code text-[11px] text-faint">{new Date(ver.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
              </button>
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={v.version} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-ink">
                <FileDiff className="h-4 w-4 text-evidence" />
                {prev ? `What changed since version ${prev.version}` : "Sources in the first version"}
              </div>
              {prev && changed.length === 0 ? (
                <p className="mt-3 text-[15px] text-muted">No source changed: every file has the same fingerprint as in version {prev.version}.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {(prev ? changed : changes).map((c) => (
                    <li key={c.label + c.status} className="flex items-center justify-between rounded-xl bg-canvas px-4 py-2.5 text-[15px]">
                      <span className="text-ink">{c.label}</span>
                      <span className={cn("text-xs font-semibold", c.status === "changed" ? "text-caution" : c.status === "removed" ? "text-danger" : "text-verified")}>
                        {c.status === "changed" ? "edited" : c.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-2.5">
              <div className="text-sm font-medium text-ink">Fingerprints</div>
              <div className="flex flex-wrap gap-2">
                <CopyHash value={v.versionHash} label="version" />
                <CopyHash value={v.evidenceRoot} label="sources" />
                {sel > 0 && <CopyHash value={v.prevHash} label="points at" />}
              </div>
              <p className="flex items-center gap-2 text-sm">
                {v.commitTxHash ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-verified" />
                    <span className="text-muted">Recorded on-chain in the proposal registry</span>
                    <CopyHash value={v.commitTxHash} label="tx" />
                  </>
                ) : (
                  <span className="text-faint">Not recorded on-chain yet</span>
                )}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </Rise>
  );
}

/* ------------------------------------------------------------ event stream */

const SUPPORT = ["against", "for", "abstain"] as const;
const mrd = (w: unknown) => {
  const n = Number(w ?? 0);
  const units = n > 1e15 ? n / 1e18 : n; // backend sends wei; the mocks send whole MRD
  return units >= 1e6 ? `${(units / 1e6).toFixed(1)}M` : units.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

interface Row {
  key: string;
  title: string;
  detail?: string;
  block: number;
  tx: string;
  tone: "neutral" | "danger" | "good";
  Icon: typeof PenLine;
}

function describe(e: ChainEvent): Row | null {
  const base = { key: `${e.txHash}:${e.logIndex}`, block: e.blockNumber, tx: e.txHash };
  const a = e.args as Record<string, unknown>;
  switch (e.name) {
    case "ProposalCommitted":
      return { ...base, title: `Version ${String(a.version ?? "")} recorded on-chain`, tone: "neutral", Icon: ShieldCheck };
    case "ProposalCreated":
      return { ...base, title: "Put up for a vote", detail: a.proposer ? `by ${nameOf(String(a.proposer))}` : undefined, tone: "neutral", Icon: Megaphone };
    case "ProposalQueued":
      return { ...base, title: "Passed, and queued in the timelock", detail: "it can only run once the waiting period ends", tone: "neutral", Icon: Timer };
    case "CallScheduled":
      return null; // one per call in the batch; ProposalQueued already says it
    case "Flagged":
      return { ...base, title: "The watchdog froze it", detail: "GovernanceGuard.flag: the timelock now refuses to run it", tone: "danger", Icon: ShieldAlert };
    case "Cleared":
      return { ...base, title: "Token holders lifted the freeze", detail: "a passed vote called GovernanceGuard.clear", tone: "good", Icon: Unlock };
    case "ProposalExecuted":
    case "Executed":
    case "CallExecuted":
      return { ...base, title: "Ran on-chain", tone: "good", Icon: Play };
    case "ProposalCanceled":
      return { ...base, title: "Cancelled", tone: "neutral", Icon: X };
    default:
      return { ...base, title: e.name, tone: "neutral", Icon: PenLine };
  }
}

function Votes({ votes }: { votes: ChainEvent[] }) {
  const [open, setOpen] = useState(false);
  const weight = (e: ChainEvent) => {
    const n = Number((e.args as Record<string, unknown>).weight ?? 0);
    return n > 1e15 ? n / 1e18 : n;
  };
  const totals = [0, 0, 0];
  for (const v of votes) totals[Number((v.args as Record<string, unknown>).support ?? 2)] += weight(v);
  const sum = totals.reduce((s, x) => s + x, 0) || 1;
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="text-[15px] font-medium text-ink">
          {votes.length} votes: {mrd(totals[1])} MRD for, {mrd(totals[0])} against
        </span>
        <ChevronDown className={cn("h-4 w-4 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {/* share of voting weight that voted for; the dim remainder is against and abstain */}
      <GlowBar value={totals[1]! / sum} className="mt-3" />
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 space-y-1.5 overflow-hidden">
            {votes.map((v) => {
              const a = v.args as Record<string, unknown>;
              const side = SUPPORT[Number(a.support ?? 2)] ?? "abstain";
              return (
                <li key={`${v.txHash}:${v.logIndex}`} className="rounded-xl bg-canvas px-3 py-2 text-sm">
                  <span className="font-medium text-ink">{nameOf(String(a.voter ?? ""))}</span>{" "}
                  <span className={side === "for" ? "text-verified" : side === "against" ? "text-danger" : "text-faint"}>voted {side}</span>{" "}
                  <span className="text-faint">with {mrd(a.weight)} MRD</span>
                  {typeof a.reason === "string" && a.reason && <div className="mt-0.5 text-xs italic text-muted">&ldquo;{a.reason}&rdquo;</div>}
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Chronological on-chain story with a line that fills as you scroll (after Aceternity's TracingBeam, built here). */
function EventStream({ events }: { events: ChainEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.8", "end 0.6"] });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  const sorted = useMemo(() => [...events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex), [events]);
  const votes = sorted.filter((e) => e.name === "VoteCast");
  const items: ({ kind: "row"; row: Row } | { kind: "votes"; block: number })[] = [];
  let votesPlaced = false;
  for (const e of sorted) {
    if (e.name === "VoteCast") {
      if (!votesPlaced) items.push({ kind: "votes", block: e.blockNumber });
      votesPlaced = true;
      continue;
    }
    const row = describe(e);
    if (row) items.push({ kind: "row", row });
  }

  if (items.length === 0) return <p className="rounded-[24px] border border-line bg-panel p-6 text-muted">Nothing has happened on-chain for this proposal yet.</p>;

  return (
    <div ref={ref} className="relative pl-12">
      <div className="absolute bottom-2 left-[19.5px] top-2 w-px bg-white/10" />
      <motion.div className="absolute left-[19px] top-2 w-[2px] origin-top rounded-full bg-gradient-to-b from-white/40 to-danger" style={{ scaleY: fill, bottom: 8, boxShadow: "0 0 10px #b392ff" }} />
      <ol className="space-y-4">
        {items.map((it, i) => {
          const tone = it.kind === "row" ? it.row.tone : "neutral";
          const Icon = it.kind === "row" ? it.row.Icon : Vote;
          return (
            <motion.li
              key={it.kind === "row" ? it.row.key : "votes"}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-10% 0px" }}
              transition={{ duration: 0.45, delay: i * 0.04 }}
              className="relative"
            >
              <span
                className={cn(
                  "absolute -left-12 top-3 flex h-10 w-10 items-center justify-center rounded-full border-2 bg-panel",
                  tone === "danger" ? "border-danger text-danger shadow-[0_0_18px_rgba(167,139,250,0.4)]" : tone === "good" ? "border-verified text-verified" : "border-line text-evidence",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              {it.kind === "votes" ? (
                <Votes votes={votes} />
              ) : (
                <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4", tone === "danger" ? "border-danger/30 bg-danger/[0.05]" : "border-line bg-panel")}>
                  <div>
                    <div className={cn("text-[15px] font-medium", tone === "danger" ? "text-danger" : "text-ink")}>{it.row.title}</div>
                    {it.row.detail && <div className="mt-0.5 text-sm text-muted">{it.row.detail}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-code text-[11px] text-faint">block {it.row.block.toLocaleString("en-US")}</span>
                    <CopyHash value={it.row.tx} />
                  </div>
                </div>
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------ tab */

export function HistoryTab({ proposalId, bundle }: { proposalId: string; bundle: ProposalBundle | undefined }) {
  const [pipeline, setPipeline] = useState(false);
  if (!bundle) return <div className="h-64 animate-pulse rounded-[24px] bg-panel" />;
  return (
    <div className="space-y-6">
      <Lifecycle bundle={bundle} />
      <VersionChain versions={bundle.versions} />
      <div>
        <div className="mb-4 mt-8 text-xs font-medium text-faint">On-chain, step by step · every line has a receipt you can copy</div>
        <EventStream events={bundle.chainEvents} />
      </div>
      <div>
        <button onClick={() => setPipeline((p) => !p)} className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-5 py-2.5 text-sm font-medium text-ink shadow-sm transition-colors hover:border-ink/25">
          Detailed timeline (for engineers)
          <ChevronDown className={cn("h-4 w-4 transition-transform", pipeline && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {pipeline && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
              <NightPanel className="mt-4 space-y-4">
                <PipelineProgress proposalId={proposalId} bundle={bundle} />
                <ProposalTimeline proposalId={proposalId} versions={bundle.versions} chainEvents={bundle.chainEvents} />
              </NightPanel>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
