"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkClaim } from "@/lib/verify/client";
import { VERDICT, WITNESS_LABEL, pct, rulingLine } from "@/components/proposal/factcheckLook";
import type { Board, ClaimCheck } from "@/lib/verify/factcheck";

const EASE = [0.22, 1, 0.36, 1] as const;
const short = (t: string) => (t.length > 96 ? `${t.slice(0, 93).replace(/\s+\S*$/, "")}…` : t);

/** "Try to lie to it": the visitor types a sentence and the model rules on it against the code and every source. */
export function LieBox({ proposalId, board }: { proposalId: string; board: Board }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ claim: string; check: ClaimCheck; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // the proposal's own caught lie, one of its true claims, and a sentence anyone might assume
  const suggestions = useMemo(() => {
    const docs = board.witnesses.filter((w) => w.id !== "code").flatMap((w) => w.statements);
    const pick = (v: string) => docs.find((s) => board.rulings[s.id]?.verdict === v && s.text.length <= 140)?.text;
    return [pick("contradicted"), pick("supported"), "The person who wrote this proposal has no ties to whoever gets paid."].filter((s): s is string => !!s);
  }, [board]);

  const run = async (claim: string) => {
    const c = claim.trim();
    if (c.length < 8 || busy) return;
    setText(c);
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const check = await checkClaim(proposalId, c);
      setResult({ claim: c, check, ms: performance.now() - t0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const all = board.witnesses.flatMap((w) => w.statements);
  const r = result?.check.ruling;
  const look = r ? VERDICT[r.verdict] : null;
  const decider = result?.check.evidence.find((e) => e.id === r?.evidence);

  return (
    <div className="rounded-[24px] border border-line bg-panel p-6 sm:p-8">
      <div className="eyebrow !text-evidence">Try to lie to it</div>
      <h3 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-ink">Say something about {proposalId}. See if it holds up.</h3>
      <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-muted">Type any sentence. The model checks it against what the code does and everything the sources say, in about a second.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
        className="mt-5 flex items-center gap-2 rounded-full border border-white/[0.09] bg-canvas/70 p-1.5 pl-5 focus-within:border-evidence/50"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={400}
          placeholder="e.g. Nobody gets any new powers over the treasury."
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-faint"
          aria-label="A sentence to fact-check"
        />
        <button type="submit" disabled={busy || text.trim().length < 8} className="pill-cta !rounded-full !px-4 !py-2.5 disabled:opacity-40" aria-label="Check it">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          <span className="hidden sm:inline">Check it</span>
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button key={s} type="button" onClick={() => void run(s)} disabled={busy} className="rounded-full border border-white/[0.07] bg-white/[0.02] px-3.5 py-1.5 text-left text-xs text-muted transition-colors hover:border-evidence/40 hover:text-ink disabled:opacity-50">
            &ldquo;{short(s)}&rdquo;
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-caution">{error}</p>}

      <AnimatePresence mode="wait">
        {result && look && r && (
          <motion.div key={result.claim + result.ms} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.35, ease: EASE }} className={cn("mt-6 rounded-[20px] border p-5 sm:p-6", look.ring)}>
            <div className="flex flex-wrap items-start gap-5">
              <motion.div
                initial={{ scale: 1.8, rotate: -14, opacity: 0 }}
                animate={{ scale: 1, rotate: -6, opacity: 1 }}
                transition={{ type: "spring", stiffness: 360, damping: 16, delay: 0.1 }}
                className="rounded-lg border-2 px-3 py-1.5 font-code text-sm font-bold tracking-[0.18em]"
                style={{ color: look.color, borderColor: look.color, boxShadow: `0 0 24px ${look.color}33` }}
              >
                {look.stamp}
              </motion.div>
              <div className="min-w-0 flex-1">
                <p className="text-[17px] leading-relaxed text-ink">&ldquo;{result.claim}&rdquo;</p>
                <p className={cn("mt-2 text-sm leading-relaxed", look.text)}>
                  {r.verdict === "unclear" ? "Nothing in the code or the sources settles this, so the model won't call it either way." : rulingLine(r, decider?.text, decider?.witness === "code" ? "code" : "doc")}
                </p>
                {decider && r.verdict !== "unclear" && <p className="mt-1 text-xs text-faint">Decided by: {WITNESS_LABEL[decider.witness]}</p>}
              </div>
            </div>

            {result.check.evidence.length > 0 && (
              <div className="mt-5 border-t border-white/[0.06] pt-4">
                <div className="text-xs font-medium text-faint">What the model compared it with</div>
                <ul className="mt-3 space-y-2.5">
                  {result.check.evidence.map((e, i) => {
                    const disagree = e.contradiction >= e.entailment;
                    const v = Math.max(e.contradiction, e.entailment);
                    return (
                      <motion.li key={e.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.07 }} className="grid grid-cols-[88px_minmax(0,1fr)_128px] items-center gap-3 text-sm">
                        <span className="text-xs text-faint">{WITNESS_LABEL[e.witness]}</span>
                        <span className="truncate text-ink/85" title={all.find((s) => s.id === e.id)?.text ?? e.text}>{e.text}</span>
                        <span className="flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                            <motion.span className="block h-full rounded-full" style={{ background: v < 0.5 ? "#6F6C8C" : disagree ? VERDICT.contradicted.color : VERDICT.supported.color }} initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 0.6, delay: 0.3 + i * 0.07, ease: EASE }} />
                          </span>
                          <span className="w-14 whitespace-nowrap text-right text-[11px] text-faint">{v < 0.5 ? "—" : `${disagree ? "✗" : "✓"} ${pct(v).replace(".0%", "%")}`}</span>
                        </span>
                      </motion.li>
                    );
                  })}
                </ul>
                <p className="mt-4 text-xs text-faint">
                  Ruled in {Math.round(result.ms)} ms by DeBERTa-v3 NLI, on this server. When a source and the code disagree, the code wins.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
