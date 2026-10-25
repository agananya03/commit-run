/**
 * The cross-examination. Every witness gives statements: the proposal text, the forum thread, social posts and
 * the signed disclosure (claim-like sentences from the documents) and the code itself (codeFacts). DeBERTa NLI
 * then rules on each statement against the code's testimony and against other witnesses on the same topic.
 * The LLM is not involved: verdicts come from the NLI model only, labelled as "evidence support".
 */
import { documents, loadBundle, type Passage } from "@/lib/chat/server";
import { codeFacts, type Fact } from "@/lib/verify/facts";
import { NLI_MODEL, nliBatch, type NliScores } from "@/lib/verify/nli";

export type WitnessId = "code" | "pdf" | "forum" | "social" | "disclosure";
export type Verdict = "contradicted" | "supported" | "unclear";

export interface Statement {
  id: string;
  witness: WitnessId;
  text: string;
  topic: string;
  passageId?: string;
  sourceUri?: string;
}

export interface Link {
  from: string;
  to: string;
  kind: "contradicts" | "supports";
  score: number;
}

export interface Ruling {
  verdict: Verdict;
  score: number;
  /** the statement or fact that decided it */
  evidence?: string;
}

export interface Board {
  proposalId: string;
  model: string | null;
  ms: number;
  witnesses: { id: WitnessId; label: string; statements: Statement[] }[];
  links: Link[];
  rulings: Record<string, Ruling>;
  /** NLI evidence support for the AI summary's claims, keyed by claim id */
  summarySupport: Record<string, { support: number; contradicted: boolean }>;
}

const LABEL: Record<WitnessId, string> = { code: "The code", pdf: "Proposal", forum: "Forum", social: "Social", disclosure: "Disclosure" };
const CONTRA = 0.8;
const ENTAIL = 0.7;

const HINT = /\$|\d|usdc|budget|grant|request|alloc|owner|control|admin|privileg|approv|independ|review|audit|gas|storage|slot|upgrade|reserve|recipient|wallet|disclos|related|affiliat|milestone|chang|fund/i;

export function topicOf(t: string): string {
  const s = t.toLowerCase();
  if (/approv|allowance|spend/.test(s)) return "approvals";
  if (/owner|control|admin|privileg|role|timelock/.test(s)) return "ownership";
  if (/beneficiar|independ|financial ties|affiliat|related part|funded by|no ties/.test(s)) return "people";
  if (/\$|usdc|budget|grant|alloc|treasury|million|\d{1,3}(,\d{3})+|request/.test(s)) return "money";
  if (/upgrade|storage|slot|gas|implementation|function|code|contract/.test(s)) return "code";
  if (/team|review|audit|disclos|wallet/.test(s)) return "people";
  return "other";
}

/**
 * NLI-small calls two unrelated true sentences about the same thing a "contradiction". So only claims that
 * rule something out (no / only / sole / limited / independent…) or that state amounts and identities can be
 * contradicted; a purely descriptive claim can be supported or stay unclear, never "caught".
 */
const EXCLUSIVE = /\b(no|not|never|only|limited|purely|solely|sole|just|without|nothing|independent|none)\b/i;
const contradictable = (s: Statement) => EXCLUSIVE.test(s.text) || s.topic === "money" || s.topic === "people" || s.topic === "approvals";
const relevant = (f: Fact, s: Statement) => f.topics.includes(s.topic) && (f.topics[0] === s.topic || EXCLUSIVE.test(s.text));

const WITNESS_OF: Record<string, WitnessId | undefined> = { pdf: "pdf", forum: "forum", social: "social", disclosure: "disclosure" };

/** Claim-like sentences from a proposal's documents, a handful per witness. */
function statementsFrom(passages: Passage[]): Statement[] {
  const byWitness = new Map<WitnessId, { s: Statement; rank: number }[]>();
  const seen = new Set<string>();
  for (const p of passages) {
    const witness = WITNESS_OF[p.sourceType];
    if (!witness) continue;
    const body = p.text.replace(/^[\w@.\-]+:\s*/, ""); // drop "author:" prefixes
    for (const raw of body.split(/(?<=[.!])\s+(?=[A-Z"$(])/)) {
      const text = raw.replace(/\s+/g, " ").replace(/^[#*\->\s]+/, "").trim();
      const key = text.toLowerCase().slice(0, 80);
      // titles ("[MIP-21] …, posted by …") and data blobs are not claims
      const notAClaim = text.startsWith("[") || /posted by|\{|\}/i.test(text);
      if (text.length < 30 || text.length > 260 || text.endsWith("?") || seen.has(key) || !HINT.test(text) || notAClaim) continue;
      seen.add(key);
      const rank = (text.match(HINT) ? 1 : 0) + (/\d/.test(text) ? 1 : 0) + (/\bno\b|\bnot\b|only|limited|independent|sole/i.test(text) ? 1.5 : 0);
      const list = byWitness.get(witness) ?? [];
      list.push({ s: { id: `${witness}-${list.length + 1}`, witness, text, topic: topicOf(text), passageId: p.id, sourceUri: p.sourceUri }, rank });
      byWitness.set(witness, list);
    }
  }
  const out: Statement[] = [];
  byWitness.forEach((list) => out.push(...list.sort((a, b) => b.rank - a.rank).slice(0, 6).map((x) => x.s)));
  return out;
}

const cache = new Map<string, Promise<Board | null>>();

export function factCheck(slug: string): Promise<Board | null> {
  if (!cache.has(slug)) {
    const p = build(slug).catch(() => null);
    cache.set(slug, p);
    void p.then((b) => b?.model === null && cache.delete(slug)); // retry later if the model wasn't available
  }
  return cache.get(slug)!;
}

async function build(slug: string): Promise<Board | null> {
  const t0 = Date.now();
  const bundle = await loadBundle(slug);
  if (!bundle) return null;
  const facts: Fact[] = codeFacts(bundle).filter((f) => f.kind !== "watchdog");
  const statements = statementsFrom(documents(slug));

  // 1. every statement against the code's testimony; 2. same-topic statements across different witnesses
  const pairs: [string, string][] = [];
  const meta: { claim: Statement; against: string; kind: "fact" | "doc" }[] = [];
  for (const s of statements) {
    for (const f of facts) {
      if (!relevant(f, s)) continue;
      pairs.push([f.text, s.text]);
      meta.push({ claim: s, against: f.id, kind: "fact" });
    }
  }
  // witnesses against each other: only where amounts or identities can clash
  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i]!;
      const b = statements[j]!;
      if (a.witness === b.witness || a.topic !== b.topic || (a.topic !== "money" && a.topic !== "people")) continue;
      pairs.push([a.text, b.text]);
      meta.push({ claim: b, against: a.id, kind: "doc" });
    }
  }
  const scores = await nliBatch(pairs);

  const rulings: Record<string, Ruling> = {};
  const links: Link[] = [];
  if (scores) {
    const best = new Map<string, { contra: number; contraBy?: string; entail: number; entailBy?: string }>();
    scores.forEach((sc: NliScores, k) => {
      const m = meta[k]!;
      const cur = best.get(m.claim.id) ?? { contra: 0, entail: 0 };
      const canContra = contradictable(m.claim) && (m.kind === "fact" || sc.contradiction >= 0.9);
      if (canContra && sc.contradiction > cur.contra) Object.assign(cur, { contra: sc.contradiction, contraBy: m.against });
      if (m.kind === "fact" && sc.entailment > cur.entail) Object.assign(cur, { entail: sc.entailment, entailBy: m.against });
      best.set(m.claim.id, cur);
      if (canContra && sc.contradiction >= CONTRA) links.push({ from: m.against, to: m.claim.id, kind: "contradicts", score: +sc.contradiction.toFixed(3) });
      else if (m.kind === "fact" && sc.entailment >= 0.85) links.push({ from: m.against, to: m.claim.id, kind: "supports", score: +sc.entailment.toFixed(3) });
    });
    for (const s of statements) {
      const b = best.get(s.id) ?? { contra: 0, entail: 0 };
      rulings[s.id] =
        b.contra >= CONTRA
          ? { verdict: "contradicted", score: +b.contra.toFixed(3), evidence: b.contraBy }
          : b.entail >= ENTAIL
          ? { verdict: "supported", score: +b.entail.toFixed(3), evidence: b.entailBy }
          : { verdict: "unclear", score: +Math.max(b.contra, b.entail).toFixed(3) };
    }
  }

  // the AI summary's claims: does the quote each one cites actually support it? Is it contradicted by the code?
  const summarySupport: Board["summarySupport"] = {};
  const claims = bundle.summary?.claims ?? [];
  const sPairs: [string, string][] = [];
  const sMeta: { id: string; kind: "cite" | "fact" }[] = [];
  for (const c of claims) {
    for (const ct of c.citations) {
      sPairs.push([ct.quote, c.text]);
      sMeta.push({ id: c.id, kind: "cite" });
    }
    const asStatement: Statement = { id: c.id, witness: "pdf", text: c.text, topic: topicOf(c.text) };
    if (!contradictable(asStatement)) continue;
    for (const f of facts) {
      if (!relevant(f, asStatement)) continue;
      sPairs.push([f.text, c.text]);
      sMeta.push({ id: c.id, kind: "fact" });
    }
  }
  const sScores = sPairs.length ? await nliBatch(sPairs) : [];
  sScores?.forEach((sc, k) => {
    const m = sMeta[k]!;
    const cur = summarySupport[m.id] ?? { support: 0, contradicted: false };
    if (m.kind === "cite") cur.support = Math.max(cur.support, +sc.entailment.toFixed(3));
    else if (sc.contradiction >= CONTRA) cur.contradicted = true;
    summarySupport[m.id] = cur;
  });

  const code: Statement[] = facts.map((f) => ({ id: f.id, witness: "code" as const, text: f.text, topic: topicOf(f.text) }));
  const witnesses = (["code", "pdf", "forum", "social", "disclosure"] as WitnessId[])
    .map((id) => ({ id, label: LABEL[id], statements: id === "code" ? code : statements.filter((s) => s.witness === id) }))
    .filter((w) => w.statements.length > 0);
  return { proposalId: slug, model: scores ? NLI_MODEL : null, ms: Date.now() - t0, witnesses, links, rulings, summarySupport };
}

/** "Try to lie to it": rules on one new sentence against the code's testimony and every witness statement. */
export async function checkClaim(slug: string, claim: string): Promise<{ ruling: Ruling; evidence: { id: string; text: string; witness: WitnessId; contradiction: number; entailment: number }[]; model: string | null } | null> {
  const board = await factCheck(slug);
  if (!board) return null;
  const all = board.witnesses.flatMap((w) => w.statements);
  const scores = await nliBatch(all.map((s) => [s.text, claim]));
  if (!scores) return { ruling: { verdict: "unclear", score: 0 }, evidence: [], model: null };
  const ranked = all
    .map((s, i) => ({ id: s.id, text: s.text, witness: s.witness, contradiction: +scores[i]!.contradiction.toFixed(3), entailment: +scores[i]!.entailment.toFixed(3) }))
    .sort((a, b) => Math.max(b.contradiction, b.entailment) - Math.max(a.contradiction, a.entailment));
  // the code outranks the documents: a contradiction by the code decides the case
  const codeContra = ranked.find((r) => r.witness === "code" && r.contradiction >= CONTRA);
  const anyContra = ranked.find((r) => r.contradiction >= CONTRA);
  const support = ranked.find((r) => r.entailment >= ENTAIL);
  const decider = codeContra ?? anyContra ?? support;
  const ruling: Ruling = decider
    ? { verdict: decider === support && !codeContra && !anyContra ? "supported" : "contradicted", score: decider === support && !codeContra && !anyContra ? decider.entailment : decider.contradiction, evidence: decider.id }
    : { verdict: "unclear", score: ranked[0] ? Math.max(ranked[0].contradiction, ranked[0].entailment) : 0 };
  return { ruling, evidence: ranked.slice(0, 4), model: NLI_MODEL };
}
