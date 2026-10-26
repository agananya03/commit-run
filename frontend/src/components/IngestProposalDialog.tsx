"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, FileText, Loader2, MessageSquare, Radio, Upload, X } from "lucide-react";
import { getWatchdogSocket } from "@/lib/api";
import type { ProposalBundle } from "@/types/shared";
import { cn } from "@/lib/utils";

interface IngestProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type StepStatus = "pending" | "running" | "completed";

interface PipelineStep {
  id: string;
  label: string;
  /** plain words for the viewer */
  plain: string;
  /** what actually runs, for the technical log */
  detail: string;
}

const STEPS: PipelineStep[] = [
  { id: "ingest", label: "Read the documents", plain: "Splitting the PDF, forum thread and posts into fingerprinted passages", detail: "Parsing PDF chunks, forum threads, and social messages" },
  { id: "summarize", label: "Summarize", plain: "Working out what it asks for and what it would cost the treasury", detail: "6 parallel hybrid sub-queries & treasury calculation" },
  { id: "intent", label: "List its promises", plain: "Writing down exactly what the text says the code will and won't do", detail: "Extracting declared IntentSpec actions and promise exclusions" },
  { id: "commit", label: "Record it on-chain", plain: "Saving a fingerprint of every document so nobody can quietly edit them", detail: "Anchoring Merkle evidence root to ProposalRegistry" },
  { id: "coi", label: "Follow the money", plain: "Checking the signed disclosure and who the proposer has paid before", detail: "Bayesian wallet graph inference & EIP-191 signature check" },
  { id: "simulate", label: "Run the code", plain: "Running the exact code on a copy of the chain to see what it really does", detail: "Forking Anvil execution & calldata diff analysis" },
  { id: "verdict", label: "Compare", plain: "Putting what it promised next to what the code did", detail: "Generating forensic /explain findings and sentences" },
  { id: "risk", label: "Score the risk", plain: "Combining every check into one score, and freezing it if it's dangerous", detail: "4-stage Bayesian probability chain & timelock assessment" },
];

const PRESETS = [
  { slug: "MIP-21", title: "VaultV2: storage packing and gas optimisation", label: "The hidden upgrade", tone: "bg-danger" },
  { slug: "MIP-17", title: "Nexus Labs Ecosystem Acceleration", label: "The $5M grant", tone: "bg-caution" },
  { slug: "MIP-12", title: "Developer SDK and Subgraph Indexer Grant", label: "The honest one", tone: "bg-verified" },
];

const FILES = [
  { key: "pdf", label: "Proposal PDF", hint: "proposal.pdf", accept: ".pdf", Icon: FileText },
  { key: "forum", label: "Forum thread", hint: "forum_thread.json", accept: ".json", Icon: MessageSquare },
  { key: "social", label: "Social posts", hint: "social.json", accept: ".json", Icon: Radio },
] as const;

type FileKey = (typeof FILES)[number]["key"];

const EASE = [0.22, 1, 0.36, 1] as const;
const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS !== "false";
const API_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";
const DEMO_SLUGS = ["MIP-12", "MIP-17", "MIP-21"];
const stamp = () => new Date().toLocaleTimeString();

/** One evidence file: click or drop. */
function FileTile({ spec, file, onFile, delay }: { spec: (typeof FILES)[number]; file: File | null; onFile: (f: File | null) => void; delay: number }) {
  const [over, setOver] = useState(false);
  return (
    <motion.label
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: EASE }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-colors",
        file ? "border-evidence/40 bg-evidence/[0.07]" : over ? "border-evidence/60 bg-white/[0.04]" : "border-dashed border-white/[0.12] bg-white/[0.02] hover:border-evidence/40",
      )}
    >
      <input type="file" accept={spec.accept} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl border", file ? "border-evidence/40 bg-evidence/15 text-ice" : "border-white/10 bg-white/[0.03] text-muted group-hover:text-ice")}>
        {file ? <Check className="h-4 w-4" /> : <spec.Icon className="h-4 w-4" />}
      </span>
      <span>
        <span className="block text-sm font-medium text-ink">{spec.label}</span>
        <span className="mt-0.5 block truncate text-xs text-faint">{file ? file.name : `Drop ${spec.hint} or click`}</span>
      </span>
    </motion.label>
  );
}

/**
 * "Add a proposal": the visitor hands the watchdog a new proposal's documents and watches each check run.
 * Portalled to <body>: the nav rail it opens from is a blurred, fixed container, which would otherwise
 * squeeze the dialog into the rail's 64px width.
 */
export function IngestProposalDialog({ open, onOpenChange }: IngestProposalDialogProps) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [slug, setSlug] = useState("MIP-22");
  const [title, setTitle] = useState("Treasury Diversification & Protocol Safety Reserve");
  const [files, setFiles] = useState<Record<FileKey, File | null>>({ pdf: null, forum: null, social: null });
  const [proposer, setProposer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [statuses, setStatuses] = useState<StepStatus[]>(STEPS.map(() => "pending"));
  const [logs, setLogs] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [completedSlug, setCompletedSlug] = useState<string | null>(null);
  const logBox = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const reset = useCallback(() => {
    setIsProcessing(false);
    setCurrent(-1);
    setStatuses(STEPS.map(() => "pending"));
    setLogs([]);
    setShowLog(false);
    setCompletedSlug(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    if (isProcessing) return; // let the run finish
    onOpenChange(false);
    setTimeout(reset, 300);
  }, [isProcessing, onOpenChange, reset]);

  // Esc closes; the page behind doesn't scroll while the dialog is open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, close]);

  // live pipeline:progress events from the backend, when it's running
  useEffect(() => {
    if (!isProcessing) return;
    try {
      const socket = getWatchdogSocket();
      const onProgress = (data: { message?: string; stageIndex?: number }) => {
        if (data.message) setLogs((prev) => [...prev, `[${stamp()}] ${data.message}`]);
        if (data.stageIndex !== undefined) setCurrent(data.stageIndex);
      };
      socket.on("pipeline:progress", onProgress);
      return () => {
        socket.off("pipeline:progress", onProgress);
      };
    } catch {
      // offline: the local progression below drives the steps
    }
  }, [isProcessing]);

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [logs, showLog]);

  // when every check is done, bring the "Open the proposal" button into view
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (completedSlug) setTimeout(() => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: "smooth" }), 150);
  }, [completedSlug]);

  const log = (line: string) => setLogs((prev) => [...prev, `[${stamp()}] ${line}`]);
  const fail = (message: string) => {
    setError(message);
    log(`Stopped: ${message}`);
    setIsProcessing(false);
  };
  const showUpTo = (done: number) => setStatuses(STEPS.map((_, i): StepStatus => (i < done ? "completed" : i === done ? "running" : "pending")));

  /** Live: upload to the backend, start its pipeline, and follow what it has actually produced. */
  const runLive = async () => {
    const formData = new FormData();
    formData.append("slug", slug);
    formData.append("title", title);
    formData.append("proposer", proposer.trim());
    if (files.forum) formData.append("forum", files.forum);
    if (files.pdf) formData.append("pdf", files.pdf);
    if (files.social) formData.append("social", files.social);
    log(`Uploading ${Object.values(files).filter(Boolean).length} document(s) to POST /proposals…`);
    const created = await fetch(`${API_URL}/proposals`, { method: "POST", body: formData }).catch(() => null);
    if (!created) return fail(`the backend at ${API_URL} isn't reachable`);
    if (!created.ok) return fail(((await created.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `upload failed (HTTP ${created.status})`);
    log(`${slug} saved and fingerprinted. Starting the checks (POST /proposals/${slug}/run)…`);
    const run = await fetch(`${API_URL}/proposals/${slug}/run`, { method: "POST" }).catch(() => null);
    if (!run || (!run.ok && run.status !== 409)) return fail(`the checks didn't start${run ? ` (HTTP ${run.status})` : ""}; is Redis running?`);

    // each step leaves a trace in the bundle; no new trace for 40 s means the pipeline stopped
    let done = 0;
    let lastChange = Date.now();
    while (done < STEPS.length) {
      await new Promise((r) => setTimeout(r, 1000));
      const b = (await fetch(`${API_URL}/proposals/${slug}`).then((r) => (r.ok ? r.json() : null), () => null)) as ProposalBundle | null;
      if (!b) continue;
      const traces = [b.summary || b.intent, b.summary, b.intent, b.versions.at(-1)?.commitTxHash, b.coi, b.simulation, b.risk || b.explanation, b.risk];
      const now = traces.findIndex((t) => !t);
      const reached = now === -1 ? STEPS.length : now;
      if (reached > done) {
        for (let i = done; i < reached; i++) log(`[${i + 1}/${STEPS.length} ${STEPS[i]!.id}] done`);
        done = reached;
        lastChange = Date.now();
        setCurrent(Math.min(done, STEPS.length - 1));
        showUpTo(done);
      } else if (Date.now() - lastChange > 40_000) {
        return fail(`the checks stopped at "${STEPS[done]!.label}". The backend log or ${API_URL}/queues says why (in mock mode it needs a mock file for ${slug}).`);
      }
    }
    log("Done. Evidence fingerprinted, code simulated, risk scored.");
    setCompletedSlug(slug);
    setIsProcessing(false);
  };

  /** Demo: there's no backend to save to, so the checks are shown on the chosen demo scenario. */
  const runDemo = async () => {
    for (let i = 0; i < STEPS.length; i++) {
      setCurrent(i);
      showUpTo(i);
      log(`[${i + 1}/${STEPS.length} ${STEPS[i]!.id}] ${STEPS[i]!.detail}`);
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    showUpTo(STEPS.length);
    log(DEMO_SLUGS.includes(slug) ? "Done (demo replay)." : "Demo mode: nothing was saved. Start the backend to add real proposals.");
    setCompletedSlug(slug);
    setIsProcessing(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!USE_MOCKS && !/^0x[0-9a-fA-F]{40}$/.test(proposer.trim())) {
      setError("Enter the proposer's wallet address (0x… 40 hex characters).");
      return;
    }
    setIsProcessing(true);
    setCurrent(0);
    showUpTo(0);
    setLogs([`[${stamp()}] Starting the watchdog for ${slug}…`]);
    await (USE_MOCKS ? runDemo() : runLive());
  };

  const openProposal = () => {
    const target = completedSlug || slug;
    onOpenChange(false);
    setTimeout(reset, 300);
    // live: the proposal just saved; demo: only the three scenarios exist
    if (!USE_MOCKS) return router.push(`/proposals/${target}`);
    router.push(DEMO_SLUGS.includes(target) ? `/proposals/${target}` : "/dashboard");
  };

  const progress = Math.round((statuses.filter((s) => s === "completed").length / STEPS.length) * 100);
  const running = isProcessing || completedSlug;

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <div className="absolute inset-0 bg-[#05040F]/75 backdrop-blur-md" onClick={close} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ingest-title"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="relative flex max-h-[min(860px,calc(100vh-2rem))] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-panel shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_80px_-30px_rgba(139,92,246,0.6)]"
          >
            <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[70%] -translate-x-1/2 rounded-full bg-[#8B5CF6]/25 blur-3xl" />

            {/* header */}
            <div className="relative flex items-start justify-between gap-4 px-6 pb-2 pt-6 sm:px-8 sm:pt-8">
              <div>
                <div className="eyebrow">{running ? (completedSlug ? "All checks done" : "The watchdog is working") : "Add a proposal"}</div>
                <h2 id="ingest-title" className="mt-2 text-[28px] font-medium leading-tight tracking-[-0.03em] text-ink">
                  {running ? (completedSlug ? `${completedSlug} is in.` : `Checking ${slug}…`) : "Bring a new proposal in."}
                </h2>
                {!running && (
                  <p className="mt-2 max-w-[54ch] text-[15px] leading-relaxed text-muted">
                    Give the watchdog what the author published. It reads everything, runs the code on a copy of the chain, follows the money, and scores the risk.
                  </p>
                )}
              </div>
              <button onClick={close} disabled={isProcessing} className="rounded-full p-2 text-faint transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-30" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={body} className="relative min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 sm:px-8 sm:pb-8">
              {!running ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* demo scenarios */}
                  <div>
                    <div className="mb-2.5 text-xs font-medium text-faint">Try a demo scenario</div>
                    <div className="flex flex-wrap gap-2">
                      {PRESETS.map((p) => (
                        <button
                          key={p.slug}
                          type="button"
                          onClick={() => {
                            setSlug(p.slug);
                            setTitle(p.title);
                          }}
                          className={cn("chip !py-2 transition-colors hover:border-evidence/50", slug === p.slug && "!border-evidence/60 !bg-evidence/10 !text-ink")}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", p.tone)} />
                          <span className="font-code text-[12px] text-ice">{p.slug}</span>
                          <span>{p.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* name */}
                  <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-faint">Proposal ID</span>
                      <input
                        required
                        value={slug}
                        onChange={(e) => setSlug(e.target.value.toUpperCase())}
                        placeholder="MIP-22"
                        className="w-full rounded-xl border border-white/10 bg-canvas/60 px-3.5 py-2.5 font-code text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-evidence/60"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-faint">Title</span>
                      <input
                        required
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="What the proposal is called"
                        className="w-full rounded-xl border border-white/10 bg-canvas/60 px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-evidence/60"
                      />
                    </label>
                  </div>

                  {!USE_MOCKS && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-faint">Proposer&apos;s wallet (the money trail starts here)</span>
                      <input
                        required
                        value={proposer}
                        onChange={(e) => setProposer(e.target.value)}
                        placeholder="0x…"
                        className="w-full rounded-xl border border-white/10 bg-canvas/60 px-3.5 py-2.5 font-code text-sm text-ink outline-none transition-colors placeholder:text-faint focus:border-evidence/60"
                      />
                    </label>
                  )}

                  {/* evidence */}
                  <div>
                    <div className="mb-2.5 flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-faint">The documents</span>
                      <span className="text-[11px] text-faint">{USE_MOCKS ? "optional for the demo scenarios" : "at least one"}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {FILES.map((spec, i) => (
                        <FileTile key={spec.key} spec={spec} file={files[spec.key]} onFile={(f) => setFiles((cur) => ({ ...cur, [spec.key]: f }))} delay={0.05 + i * 0.05} />
                      ))}
                    </div>
                  </div>

                  {USE_MOCKS && (
                    <p className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-muted">
                      Demo mode: there&apos;s no backend to save to, so this replays the checks and opens the demo scenario you picked. New proposals are saved when the site runs against the backend (NEXT_PUBLIC_USE_MOCKS=false).
                    </p>
                  )}
                  {error && <p className="text-sm text-[#FF9DAA]">{error}</p>}

                  <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/[0.06] pt-5">
                    <button type="button" onClick={close} className="pill-cta pill-ice !rounded-full !px-5 !py-2.5 !text-sm">
                      Cancel
                    </button>
                    <button type="submit" className="pill-cta pill-danger !rounded-full !px-5 !py-2.5 !text-sm">
                      <Upload className="h-4 w-4" />
                      Start the watchdog
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-5">
                  {/* progress */}
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs text-faint">
                      <span>{completedSlug ? "Every check finished" : `Step ${Math.max(current, 0) + 1} of ${STEPS.length}`}</span>
                      <span className="font-code text-ice">{progress}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#C4B5FD] shadow-[0_0_12px_rgba(167,139,250,0.8)]" animate={{ width: `${progress}%` }} transition={{ duration: 0.5, ease: EASE }} />
                    </div>
                  </div>

                  {/* steps */}
                  <ol className="relative space-y-1">
                    {STEPS.map((s, i) => {
                      const st = statuses[i]!;
                      return (
                        <motion.li
                          key={s.id}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: st === "pending" ? 0.45 : 1, x: 0 }}
                          transition={{ duration: 0.3, delay: i * 0.03 }}
                          className={cn("flex gap-3.5 rounded-2xl px-3 py-2.5 transition-colors", st === "running" && "bg-white/[0.04]")}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border",
                              st === "completed" ? "border-evidence/50 bg-evidence/20 text-ice" : st === "running" ? "border-evidence/70 text-ice" : "border-white/15 text-faint",
                            )}
                          >
                            {st === "completed" ? <Check className="h-3 w-3" strokeWidth={3} /> : st === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[10px]">{i + 1}</span>}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink">{s.label}</span>
                            {st !== "pending" && <span className="mt-0.5 block text-xs leading-relaxed text-muted">{s.plain}</span>}
                          </span>
                        </motion.li>
                      );
                    })}
                  </ol>

                  {/* technical log */}
                  <div className="rounded-2xl border border-white/[0.06] bg-night/70">
                    <button type="button" onClick={() => setShowLog((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-xs text-faint hover:text-muted">
                      <span>Technical log (for engineers)</span>
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showLog && "rotate-180")} />
                    </button>
                    <AnimatePresence initial={false}>
                      {showLog && (
                        <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                          <div ref={logBox} className="max-h-40 space-y-1 overflow-y-auto border-t border-white/[0.06] px-4 py-3 font-code text-[11px] leading-relaxed text-muted">
                            {logs.map((l, i) => (
                              <div key={i}>
                                <span className="mr-1.5 text-evidence">›</span>
                                {l}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {completedSlug && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-5">
                      <span className="text-sm text-muted">
                        {!USE_MOCKS ? "Saved, fingerprinted and every check run." : DEMO_SLUGS.includes(completedSlug) ? "Demo replay of the checks." : "Demo mode: nothing was saved."}
                      </span>
                      <button onClick={openProposal} className="pill-cta pill-danger !rounded-full !px-5 !py-2.5 !text-sm">
                        {USE_MOCKS && !DEMO_SLUGS.includes(completedSlug) ? "Back to all proposals" : `Open ${completedSlug}`} <ArrowRight className="h-4 w-4" />
                      </button>
                    </motion.div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
