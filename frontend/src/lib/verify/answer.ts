/**
 * "Verified, not vibes" for the assistant: after an answer streams, every sentence is checked with the same NLI
 * model as the fact-check board. Premises are the code's testimony and the watchdog's record for the proposal the
 * sentence is about, the findings, and source passages (the ones it cites plus the best matches). A sentence is
 * grounded when some premise entails it, contradicted when the code's testimony overrules it, and unverified
 * otherwise. The language model never grades itself.
 */
import { loadBundle, localSearch, recordLines, type ChatEvent, type Passage } from "@/lib/chat/server";
import { canContradict, statement, topicsOf } from "@/lib/verify/factcheck";
import { codeFacts, type Fact } from "@/lib/verify/facts";
import { NLI_MODEL, nliBatch } from "@/lib/verify/nli";

type Sources = Extract<ChatEvent, { type: "sources" }>;

export interface SentenceCheck {
  /** character span in the full answer text, trailing citations included */
  start: number;
  end: number;
  verdict: "grounded" | "unverified" | "contradicted";
  score: number;
  evidence?: { text: string; source: "code" | "watchdog" | "finding" | "passage"; proposalId: string; passageId?: string };
}

const CONTRA = 0.8;
const ENTAIL = 0.7;
const CITE = /\[{1,2}(?:finding:)?[A-Za-z0-9][\w.\-]*(?::[\w.\-]+)+\]{1,2}/g;
/** reported speech ("the proposal claims…") is true as a report even when the claim is false */
const REPORTED = /\b(claims?|claimed|says?|said|states?|stated|promis\w*|propos(es|ed|ing)|according to|describes?|described|asserts?|wrote|writes|argues?|insists?|tells?|told)\b/i;

/** Sentence spans over the whole answer; a sentence ends at . ! ? before a space (outside quotes), or at a line break. */
export function sentenceSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' || ch === "“" || ch === "”") quoted = ch === "“" ? true : ch === "”" ? false : !quoted;
    const lineEnd = ch === "\n";
    if (lineEnd) quoted = false;
    const stop = !quoted && /[.!?]/.test(ch) && (i + 1 >= text.length || /[\s[]/.test(text[i + 1]!));
    if (!lineEnd && !stop && i !== text.length - 1) continue;
    let end = lineEnd ? i : i + 1;
    if (stop) end += /^(\s*\[{1,2}[^\]\n]+\]{1,2})*/.exec(text.slice(end))![0].length; // citations belong to the sentence before them
    if (text.slice(start, end).trim()) out.push({ start, end });
    start = lineEnd ? i + 1 : end;
    i = Math.max(i, start - 1);
  }
  return out;
}

const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9$#]+/g) ?? []).filter((t) => t.length > 3 || /\d/.test(t)));

/** The k premises sharing the most words with the sentence, normalised so long passages don't win by size. */
function closest(sentence: string, pool: Premise[], k: number): Premise[] {
  const s = words(sentence);
  return pool
    .map((p) => {
      const w = words(p.text);
      let shared = 0;
      w.forEach((t) => {
        if (s.has(t)) shared++;
      });
      return { p, score: shared / Math.sqrt(w.size || 1) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.p);
}

interface Premise {
  text: string;
  source: NonNullable<SentenceCheck["evidence"]>["source"];
  proposalId: string;
  topics: string[];
  passageId?: string;
  fact?: Fact;
}

/** sentences checked per event, so badges appear while the rest are still being checked */
const GROUP = 3;

export async function* verifyAnswer(text: string, src: Sources): AsyncGenerator<Extract<ChatEvent, { type: "verify" }>> {
  const t0 = Date.now();
  const factsBy = new Map<string, Premise[]>();
  const premisesFor = async (slug: string): Promise<Premise[]> => {
    if (factsBy.has(slug)) return factsBy.get(slug)!;
    const b = await loadBundle(slug);
    const list: Premise[] = [];
    if (b) {
      for (const f of codeFacts(b)) list.push({ text: f.text, source: f.kind === "watchdog" ? "watchdog" : "code", proposalId: slug, topics: f.topics, fact: f });
      for (const f of b.findings) list.push({ text: f.does, source: "finding", proposalId: slug, topics: topicsOf(f.does) });
      // the record the assistant answered from (support only; the code's testimony is what overrules)
      for (const line of recordLines(b)) list.push({ text: line, source: "watchdog", proposalId: slug, topics: topicsOf(line) });
    }
    factsBy.set(slug, list);
    return list;
  };

  // which proposal each sentence is about: the one it names, else the one named last, else the only one in play
  const spans = sentenceSpans(text);
  let last: string | null = src.proposals.length === 1 ? src.proposals[0]! : null;
  const work: { span: { start: number; end: number }; clean: string; slugs: string[]; cited: Passage[] }[] = [];
  for (const span of spans) {
    const raw = text.slice(span.start, span.end);
    const named = Array.from(raw.matchAll(/MIP[\s-]?(\d+)/gi)).map((m) => `MIP-${m[1]}`).filter((s) => src.proposals.indexOf(s) >= 0);
    if (named.length) last = named[0]!;
    const clean = raw.replace(CITE, "").replace(/\*\*/g, "").replace(/^\s*[-*•]\s+/, "").replace(/\s+/g, " ").trim();
    const heading = /^\s*([-*•]\s+)?\*\*[^*]+\*\*:?\s*$/.test(raw.replace(CITE, ""));
    if (heading || clean.length < 25 || clean.endsWith("?") || clean.endsWith(":") || /^I can't reach/i.test(clean)) continue;
    const ids = Array.from(raw.matchAll(CITE)).map((m) => m[0].replace(/^\[+|\]+$/g, ""));
    const cited = src.passages.filter((p) => ids.indexOf(p.id) >= 0);
    work.push({ span, clean, slugs: named.length ? named : last ? [last] : src.proposals, cited });
  }
  for (let g = 0; g < work.length; g += GROUP) {
    const sentences = await checkGroup(work.slice(g, g + GROUP), premisesFor);
    if (!sentences) return; // model unavailable: no badges rather than made-up ones
    yield { type: "verify", sentences, model: NLI_MODEL, ms: Date.now() - t0 };
  }
}

async function checkGroup(
  work: { span: { start: number; end: number }; clean: string; slugs: string[]; cited: Passage[] }[],
  premisesFor: (slug: string) => Promise<Premise[]>,
): Promise<SentenceCheck[] | null> {
  const pairs: [string, string][] = [];
  const meta: { w: number; premise: Premise; kind: "contra" | "support" }[] = [];
  for (let w = 0; w < work.length; w++) {
    const { clean, slugs, cited } = work[w]!;
    const stmt = statement(`s${w}`, "pdf", clean);
    const reported = REPORTED.test(clean);
    const passages = new Map<string, Passage>();
    for (const p of cited) passages.set(p.id, p);
    for (const p of localSearch(clean, slugs, 2)) passages.set(p.id, p);
    // facts, findings and record lines only where the sentence touches their topic (all if it touches none we know)
    const known: Premise[] = (await Promise.all(slugs.map(premisesFor))).flat();
    const pool = known.filter((p) => !stmt.topics.length || p.topics.some((t) => stmt.topics.indexOf(t) >= 0));
    passages.forEach((p) => pool.push({ text: p.text.replace(/0x[0-9a-f]{40,}/gi, "0x…").slice(0, 420), source: "passage", proposalId: p.proposalId, topics: [], passageId: p.id }));
    // support: the few premises sharing the most words with the sentence (keeps a long answer to a couple of seconds)
    for (const premise of closest(clean, pool, 6)) {
      pairs.push([premise.text, clean]);
      meta.push({ w, premise, kind: "support" });
      if (premise.fact) {
        // facts are short: also ask whether the sentence implies the fact
        pairs.push([clean, premise.text]);
        meta.push({ w, premise, kind: "support" });
      }
    }
    // overrule: only the code's testimony and the watchdog's record, one proposal at a time
    if (!reported && slugs.length === 1)
      for (const premise of known)
        if (premise.fact && canContradict(premise.fact, stmt)) {
          pairs.push([premise.text, clean]);
          meta.push({ w, premise, kind: "contra" });
        }
  }

  const scores = pairs.length ? await nliBatch(pairs) : [];
  if (!scores) return null;
  const best = work.map(() => ({ contra: 0, contraBy: undefined as Premise | undefined, entail: 0, entailBy: undefined as Premise | undefined }));
  scores.forEach((sc, k) => {
    const m = meta[k]!;
    const b = best[m.w]!;
    if (m.kind === "contra" && sc.contradiction > b.contra) Object.assign(b, { contra: sc.contradiction, contraBy: m.premise });
    if (m.kind === "support" && sc.entailment > b.entail) Object.assign(b, { entail: sc.entailment, entailBy: m.premise });
  });

  const evidence = (p?: Premise): SentenceCheck["evidence"] => (p ? { text: p.text, source: p.source, proposalId: p.proposalId, passageId: p.passageId } : undefined);
  return work.map(({ span }, w): SentenceCheck => {
    const b = best[w]!;
    // a contradiction only stands if no premise backs the sentence even more strongly
    if (b.contra >= CONTRA && b.contra > b.entail) return { ...span, verdict: "contradicted", score: +b.contra.toFixed(3), evidence: evidence(b.contraBy) };
    if (b.entail >= ENTAIL) return { ...span, verdict: "grounded", score: +b.entail.toFixed(3), evidence: evidence(b.entailBy) };
    return { ...span, verdict: "unverified", score: +b.entail.toFixed(3), evidence: b.entail >= 0.3 ? evidence(b.entailBy) : undefined };
  });
}
