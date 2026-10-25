"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, ChevronDown, FileText, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Citation } from "@/components/Citation";
import { useEvidencePanel } from "@/components/EvidencePanel";
import type { ChatEvent, FindingRef, Passage } from "@/lib/chat/server";

type Sources = Extract<ChatEvent, { type: "sources" }>;

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  sources?: Sources;
  streaming?: boolean;
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = { forum: "Forum", pdf: "Proposal", social: "Social", onchain: "On-chain", disclosure: "Disclosure" };

/* ---------------------------------------------------------------- rendering the answer */

// [[id]], [id], [[finding:x]]: tolerant of the model grouping or single-bracketing citations
const TOKEN = /(\*\*[^*]+\*\*|\[{1,2}(?:finding:)?[A-Za-z0-9][\w.\-]*(?::[\w.\-]+)+\]{1,2})/;
const IS_CITE = /^\[{1,2}(?:finding:)?[A-Za-z0-9][\w.\-]*(?::[\w.\-]+)+\]{1,2}$/;

function Inline({ text, sources }: { text: string; sources?: Sources }) {
  const parts = text.split(TOKEN);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
        if (IS_CITE.test(part)) {
          const id = part.replace(/^\[+|\]+$/g, "");
          if (id.startsWith("finding:")) {
            const f: FindingRef | undefined = sources?.findings.find((x) => x.id === id.slice(8));
            return f ? (
              <Link key={i} href={`/proposals/${f.proposalId}?tab=execution`} className="mx-0.5 inline-flex items-center rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 align-middle text-[10px] text-[#DDD6FE] hover:border-[#A78BFA]/60">
                {f.label}
              </Link>
            ) : null;
          }
          const idx = sources?.passages.findIndex((p) => p.id === id) ?? -1;
          const p = idx >= 0 ? sources!.passages[idx]! : null;
          return p ? <Citation key={i} citation={{ chunkId: p.id, sha256: p.sha256 as `0x${string}`, quote: p.text, sourceUri: p.sourceUri }} index={idx + 1} className="mx-0.5 align-middle" /> : null;
        }
        // drop stray separators the model leaves between grouped citations
        return <span key={i}>{part.replace(/^,\s*$/, " ")}</span>;
      })}
    </>
  );
}

function Answer({ text, sources }: { text: string; sources?: Sources }) {
  const blocks: { bullet: boolean; text: string }[] = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/^[-*•]\s+/.test(l) ? { bullet: true, text: l.replace(/^[-*•]\s+/, "") } : { bullet: false, text: l }));
  return (
    <div className="space-y-2">
      {blocks.map((b, i) =>
        b.bullet ? (
          <div key={i} className="flex gap-2">
            <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-[#A78BFA]" />
            <p>
              <Inline text={b.text} sources={sources} />
            </p>
          </div>
        ) : (
          <p key={i}>
            <Inline text={b.text} sources={sources} />
          </p>
        ),
      )}
    </div>
  );
}

function SourcesLine({ sources }: { sources: Sources }) {
  const [open, setOpen] = useState(false);
  const { openCitation } = useEvidencePanel();
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-2.5">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left text-[11px] text-faint hover:text-muted">
        <span>
          Read {sources.passages.length} passage{sources.passages.length === 1 ? "" : "s"} from {sources.proposals.join(", ")}
          {sources.facts.length > 0 && ` · used ${sources.facts.join(", ")}`}
          {sources.mode === "offline" && " · offline answer"}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 space-y-1.5 overflow-hidden">
            {sources.passages.map((p: Passage, i) => (
              <li key={p.id}>
                <button
                  onClick={() => openCitation({ chunkId: p.id, sha256: p.sha256 as `0x${string}`, quote: p.text, sourceUri: p.sourceUri })}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-white/15"
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-faint">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#8B5CF6]/50 bg-[#2a1b5c] text-[9px] text-[#EDE9FE]">{i + 1}</span>
                    <FileText className="h-3 w-3" /> {SOURCE_LABEL[p.sourceType] ?? p.sourceType} · {p.proposalId}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">{p.text}</div>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- the assistant */

function suggestionsFor(page: string | null): string[] {
  if (page)
    return [`Why did the watchdog flag ${page}?`, `Who really benefits from ${page}?`, `What did ${page} promise, and does the code keep it?`, `Who voted on ${page}, and why?`];
  return ["Which proposals are risky, and why?", "Compare MIP-17 and MIP-12 in plain words", "How does the watchdog decide to freeze a proposal?", "Is anyone secretly linked to who gets paid?"];
}

/**
 * The watchdog assistant: a floating chat that answers from the proposals' own evidence (RAG passages, all
 * scenario documents, findings, simulation, money trail, votes), streams the answer, and cites every source.
 * Lives in the app layout, so the conversation survives page changes.
 */
export function ChatAssistant() {
  const pathname = usePathname();
  const page = /^\/proposals\/([A-Z]+-\d+)/.exec(pathname ?? "")?.[1] ?? null;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);
  const suggestions = useMemo(() => suggestionsFor(page), [page]);

  // "/" opens, Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
      if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 250);
  }, [open]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setDraft("");
      const user: Msg = { id: nextId.current++, role: "user", text: q };
      const reply: Msg = { id: nextId.current++, role: "assistant", text: "", streaming: true };
      const history = [...msgs, user].filter((m) => !m.error && m.text).map((m) => ({ role: m.role, text: m.text }));
      setMsgs((m) => [...m, user, reply]);
      setBusy(true);
      const ctrl = new AbortController();
      abort.current = ctrl;
      const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === reply.id ? fn(m) : m)));
      try {
        const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, page }), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line) as ChatEvent;
            if (ev.type === "sources") patch((m) => ({ ...m, sources: ev }));
            else if (ev.type === "delta") patch((m) => ({ ...m, text: m.text + ev.text }));
            else if (ev.type === "error") patch((m) => ({ ...m, error: ev.message }));
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, error: "Couldn't reach the assistant. Is the frontend server running?" }));
      } finally {
        patch((m) => ({ ...m, streaming: false }));
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, msgs, page],
  );

  return (
    <div className="no-print">
      {/* launcher */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onClick={() => setOpen(true)}
            className="group fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-2xl border border-[#8B5CF6]/40 bg-[#100F22]/85 py-2.5 pl-3 pr-4 text-sm font-medium text-ink shadow-[0_10px_40px_-10px_rgba(139,92,246,0.7)] backdrop-blur-xl transition-colors hover:border-[#A78BFA]/70"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-b from-[#4c2fa3] to-[#2a1b5c] shadow-[0_0_14px_-2px_rgba(139,92,246,0.9)]">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </span>
            Ask the watchdog
            <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 text-[11px] text-faint">/</kbd>
          </motion.button>
        )}
      </AnimatePresence>

      {/* panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed bottom-6 right-6 z-50 flex h-[min(680px,calc(100vh-6rem))] w-[min(440px,calc(100vw-5.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0D0C1F]/95 shadow-[0_30px_100px_-20px_rgba(0,0,0,0.9),0_0_60px_-20px_rgba(139,92,246,0.5)] backdrop-blur-xl"
          >
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[80%] -translate-x-1/2 rounded-full bg-[#8B5CF6]/25 blur-3xl" />

            {/* header */}
            <div className="relative flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#8B5CF6]/40 bg-gradient-to-b from-[#4c2fa3] to-[#2a1b5c]">
                <Sparkles className="h-4 w-4 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">Watchdog assistant</div>
                <div className="truncate text-[11px] text-faint">Answers only from the proposals&apos; own evidence</div>
              </div>
              {page && <span className="chip !px-2.5 !py-1 !text-[11px]">Reading {page}</span>}
              <button onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-faint transition-colors hover:bg-white/[0.06] hover:text-ink" aria-label="Close the assistant">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* conversation */}
            <div ref={scroller} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {msgs.length === 0 && (
                <div className="flex h-full flex-col justify-end">
                  <div className="mb-auto mt-6 text-center">
                    <div className="mx-auto mb-4 h-12 w-12 rounded-2xl border border-[#8B5CF6]/40 bg-gradient-to-b from-[#4c2fa3] to-[#2a1b5c] p-3 shadow-[0_0_40px_-6px_rgba(139,92,246,0.8)]">
                      <Sparkles className="h-6 w-6 text-white" />
                    </div>
                    <div className="ice-text text-lg font-medium">Ask anything about Meridian&apos;s proposals</div>
                    <p className="mx-auto mt-1 max-w-[30ch] text-xs text-faint">I read the forum posts, PDFs, socials, the simulated code, the money trail and the votes, and cite every source.</p>
                  </div>
                  <div className="space-y-2">
                    {suggestions.map((s) => (
                      <button key={s} onClick={() => void send(s)} className="block w-full rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-left text-[13px] text-muted transition-colors hover:border-[#8B5CF6]/40 hover:text-ink">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {msgs.map((m) =>
                m.role === "user" ? (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="ml-10 rounded-2xl rounded-br-md border border-[#8B5CF6]/35 bg-gradient-to-b from-[#3a2580]/70 to-[#261759]/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
                    {m.text}
                  </motion.div>
                ) : (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mr-4 rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.025] px-3.5 py-3 text-[13px] leading-relaxed text-ink/90">
                    {m.error ? (
                      <p className="text-faint">{m.error}</p>
                    ) : m.text ? (
                      <Answer text={m.text} sources={m.sources} />
                    ) : (
                      <div className="flex items-center gap-2 text-faint">
                        <span className="flex gap-1">
                          {[0, 1, 2].map((d) => (
                            <motion.span key={d} className="h-1.5 w-1.5 rounded-full bg-[#A78BFA]" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.1, repeat: Infinity, delay: d * 0.18 }} />
                          ))}
                        </span>
                        <span className="text-[12px]">reading the evidence…</span>
                      </div>
                    )}
                    {m.streaming && m.text && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-[#A78BFA] align-middle" />}
                    {!m.streaming && m.sources && !m.error && <SourcesLine sources={m.sources} />}
                  </motion.div>
                ),
              )}
            </div>

            {/* composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
              className="relative border-t border-white/[0.06] p-3"
            >
              <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1.5 pl-3 transition-colors focus-within:border-[#8B5CF6]/50">
                <textarea
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  rows={1}
                  placeholder={page ? `Ask about ${page}…` : "Ask about any proposal…"}
                  className="max-h-28 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13px] text-ink placeholder:text-faint focus:outline-none"
                />
                {busy ? (
                  <button type="button" onClick={() => abort.current?.abort()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-ink hover:bg-white/[0.1]" aria-label="Stop">
                    <Square className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button type="submit" disabled={!draft.trim()} className="pill-danger flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-40" aria-label="Send">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-1.5 text-center text-[10px] text-faint">Grounded in the demo&apos;s documents. Answers can still be wrong; check the cited sources.</div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
