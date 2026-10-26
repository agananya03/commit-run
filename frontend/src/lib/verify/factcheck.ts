/**
 * The cross-examination. Every witness gives statements: the proposal text, the forum thread, social posts and
 * the signed disclosure (claim-like sentences from the documents) and the code itself (codeFacts). DeBERTa NLI
 * then rules on each document statement against the code's testimony.
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
  /** the main topic, shown on the board */
  topic: string;
  /** every topic the sentence touches */
  topics: string[];
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
  /** decided by an exact amount or wallet match with the code, not by the NLI model */
  exact?: boolean;
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
  if (/approv|allowance|\bspend\b/.test(s)) return "approvals";
  if (/owner|control|admin|privileg|role|timelock/.test(s)) return "ownership";
  if (/beneficiar|financial ties|affiliat|related part|funded by|no ties|\bdisclos|\bwallet\b|\bsigner/.test(s)) return "people";
  if (/\bindependent\b/i.test(s) && !/\b(market maker|amm|protocol|exchange|pool)s?\b/i.test(s)) return "people";
  if (/upgrade|storage|slot|gas|implementation|function|contract/.test(s) && !/\$|usdc|treasury/.test(s)) return "code";
  if (/\$|\busdc\b|\bbudget\b|\bgrant\b|\ballocation\b|\btreasury\b|\bmillion\b|\bfund(ing|ed)?\b|\brequest(ing|ed)?\s*(\$|\d)/.test(s)) return "money";
  if (/upgrade|storage|slot|gas|implementation|function|code|contract/.test(s)) return "code";
  if (/\b(team|review|audit)\b/.test(s)) return "people";
  return "other";
}

const TOPIC_RX: [string, RegExp][] = [
  ["approvals", /approv|allowance|\bspend\b/],
  ["ownership", /owner|control|admin|privileg|\broles?\b|timelock/],
  ["people", /beneficiar|financial ties|affiliat|related part|funded by|\bties\b|connection|relationship|\bdisclos|\bsigner|\b(team|review|audit)\b/],
  ["money", /\$|\busdc\b|\bmoney\b|\bbudget\b|\bgrant\b|\ballocation\b|\btreasury\b|\bmillion\b|\bfund(s|ing|ed)?\b|\bpa(id|ys?|yment)\b|recipient|disburs|sen[dt]s? (\w+ )?to/],
  ["code", /upgrade|storage|slot|\bgas\b|implementation|function|contract|bytecode|\bcode\b/],
  ["status", /\b(froze|frozen|freez\w*|stopped|halted|flagged|blocked)\b/],
  ["risk", /\brisk\b|likely to be harmful/],
];

/** Every topic a sentence touches. */
export function topicsOf(t: string): string[] {
  const s = t.toLowerCase();
  const out = TOPIC_RX.filter(([, rx]) => rx.test(s)).map(([k]) => k);
  if (/\bindependent\b/.test(s) && !/\b(market maker|amm|protocol|exchange|pool)s?\b/.test(s) && out.indexOf("people") < 0) out.push("people");
  return out;
}

export function statement(id: string, witness: WitnessId, text: string, extra?: Partial<Statement>): Statement {
  const topic = topicOf(text);
  const topics = topicsOf(text);
  if (topic !== "other" && topics.indexOf(topic) < 0) topics.unshift(topic);
  return { id, witness, text, topic, topics, ...extra };
}

/**
 * NLI-small calls two true sentences about the same thing a "contradiction". So a fact may only overrule a claim
 * that rules something out on the fact's topic ("limited to…", "no change to ownership", "independent"), or one
 * that states the amount or recipient the code actually pays. "Nothing happens" facts only ever confirm, and
 * opinions and questions are never "caught".
 */
const EXCLUSIVE =
  /\b(only|solely|sole|purely|exclusively|limited to|restricted to|nothing (else|more)|none|zero|independent|remains?|stays?|unchanged|no (\w+[ ,]+){0,3}?(change|changes|ties|links|connections?|relationships?|affiliations?|beneficiar\w*|approvals?|transfers?|upgrades?|access|keys|admin|powers?)|(does|will) not (change|alter|affect|touch|grant|give|transfer|upgrade))\b/i;
const COMMENTARY = /\b((we|you) (cannot|can't|must|should|need to)|questions? remain|unanswered|urging|alarming|concern(s|ed|ing)?|unprecedented|i think|i believe|excited|great work|thanks)\b/i;
const isAmountClaim = (t: string) => /\$|\b\d+(\.\d+)?\s*(m|million|k|usdc)\b/i.test(t) && /request|budget|grant|\ballocation\b|total|cost|fund/i.test(t);
const isRecipientClaim = (t: string) => /recipient|disburs|paid to|pays?\b|sen[dt]s? (\w+ )?to|go(es)? (straight |directly )?to|transferred to|receiv(e|es|ing)\b/i.test(t);

/** Dollar/token amounts in a sentence ("$5M", "400K USDC", "5,000,000"), percentages and small numbers left out. */
function amountsIn(t: string): number[] {
  const out: number[] = [];
  const rx = /(\d+(?:[.,]\d+)*)\s*(k|m|million)?\b(?!\s*%)/gi;
  for (let m = rx.exec(t); m; m = rx.exec(t)) {
    const n = Number(m[1]!.replace(/,/g, "")) * ({ k: 1e3, m: 1e6, million: 1e6 }[(m[2] ?? "").toLowerCase()] ?? 1);
    if (n >= 1000) out.push(n);
  }
  return out;
}
/** NLI-small can't compare numbers, so when a claim states the same amount the code pays, only the recipient can clash. */
const sameAmount = (f: Fact, s: Statement) => amountsIn(s.text).some((n) => amountsIn(f.text).indexOf(n) >= 0);

/** Wallet numbers named in a sentence: "wallet index 12", "Wallet #17", "recipient index 9". */
function walletsIn(t: string): string[] {
  const out: string[] = [];
  const rx = /\b(?:wallet|index)\s*(?:index\s*)?#?(\d{1,3})\b/gi;
  for (let m = rx.exec(t); m; m = rx.exec(t)) out.push(m[1]!);
  return out;
}

/** What an exclusive claim rules on: "…limited to slot packing" → code, "no change to ownership" → ownership. */
function scopeOf(s: Statement): string[] {
  const m = EXCLUSIVE.exec(s.text);
  if (!m) return [];
  const window = s.text.slice(m.index).split(/[.;]/)[0]!.split(/\s+/).slice(0, 8).join(" ");
  return topicsOf(window);
}

export function canContradict(f: Fact, s: Statement): boolean {
  if (f.negative || COMMENTARY.test(s.text)) return false;
  // "was frozen" / "low risk" vs the watchdog's own record
  if (f.topics[0] === "status" || f.topics[0] === "risk") return s.topics.indexOf(f.topics[0]) >= 0;
  const scope = scopeOf(s);
  if (f.topics.some((t) => scope.indexOf(t) >= 0)) return true;
  if (f.topics[0] === "money") {
    if (s.topics.indexOf("money") < 0) return false;
    const sameWallet = walletsIn(s.text).some((w) => walletsIn(f.text).indexOf(w) >= 0); // names the wallet the code pays
    return (isRecipientClaim(s.text) && !sameWallet) || (isAmountClaim(s.text) && !sameAmount(f, s));
  }
  return f.topics[0] === "approvals" && s.topics.indexOf("approvals") >= 0;
}
export const canSupport = (f: Fact, s: Statement) => s.topics.indexOf(f.topics[0]!) >= 0;

const WITNESS_OF: Record<string, WitnessId | undefined> = { pdf: "pdf", forum: "forum", social: "social", disclosure: "disclosure" };
const QUESTION = /\?|^(can|could|would|will|is|are|does|do|why|how|what|who|where|when|should)\b/i;

/** Claim-like sentences from a proposal's documents, a handful per witness. */
function statementsFrom(passages: Passage[]): Statement[] {
  const byWitness = new Map<WitnessId, { s: Statement; rank: number }[]>();
  const seen = new Set<string>();
  for (const p of passages) {
    const witness = WITNESS_OF[p.sourceType];
    if (!witness) continue;
    const body = p.text.replace(/^[\w@.\-]+:\s*/, ""); // drop "author:" prefixes
    // a budget table's total row is a claim too, though not a sentence: state it with the table's own figure
    for (const row of p.text.split("\n").filter((l) => /^\s*\|.*\btotal\b.*\|/i.test(l))) {
      const amount = row.match(/\$\s?[\d,]+(?:\.\d+)?\s?(?:[MK]\b)?/gi)?.pop();
      if (!amount || seen.has(`total:${amount}`)) continue;
      seen.add(`total:${amount}`);
      const list = byWitness.get(witness) ?? [];
      const text = `The proposal's itemized budget table totals ${amount.replace(/\s+/g, "")}.`;
      list.push({ s: statement(`${witness}-${list.length + 1}`, witness, text, { passageId: p.id, sourceUri: p.sourceUri }), rank: 4 });
      byWitness.set(witness, list);
    }
    for (const raw of body.split(/(?<=[.!?])\s+(?=[A-Z"$(])/)) {
      const text = raw.replace(/\s+/g, " ").replace(/^[#*\->\s]+/, "").trim();
      const key = text.toLowerCase().slice(0, 80);
      // titles, headers, markdown tables, comments, questions and data blobs are not claims
      const notAClaim =
        text.startsWith("[") ||
        text.startsWith("#") ||
        text.startsWith("<!--") ||
        text.startsWith("|") ||
        QUESTION.test(text) ||
        /^(proposal title|status|category|synthetic simulation|proposer|beneficiary):/i.test(text) ||
        /posted by|\{|\}/i.test(text);
      if (text.length < 30 || text.length > 260 || seen.has(key) || !HINT.test(text) || notAClaim) continue;
      seen.add(key);
      const rank = (text.match(HINT) ? 1 : 0) + (/\d/.test(text) ? 1 : 0) + (EXCLUSIVE.test(text) ? 1.5 : 0);
      const list = byWitness.get(witness) ?? [];
      list.push({ s: statement(`${witness}-${list.length + 1}`, witness, text, { passageId: p.id, sourceUri: p.sourceUri }), rank });
      byWitness.set(witness, list);
    }
  }
  const out: Statement[] = [];
  byWitness.forEach((list) => out.push(...list.sort((a, b) => b.rank - a.rank).slice(0, 6).map((x) => x.s)));
  return out;
}

const cache = new Map<string, Promise<Board | null>>();

/** Cached per proposal and simulation: a board built before the code ran (or on older mock data) isn't reused. */
export async function factCheck(slug: string): Promise<Board | null> {
  const bundle = await loadBundle(slug);
  if (!bundle) return null;
  const key = `${slug}:${bundle.simulation?.simHash ?? "no-sim"}:${bundle.simulation?.tokenTransfers.map((t) => t.to).join(",") ?? ""}:${bundle.coi?.proposer ?? ""}`;
  if (!cache.has(key)) {
    const p = build(slug).catch(() => null);
    cache.set(key, p);
    void p.then((b) => b?.model === null && cache.delete(key)); // retry later if the model wasn't available
  }
  return cache.get(key)!;
}

async function factsFor(slug: string): Promise<Fact[] | null> {
  const bundle = await loadBundle(slug);
  return bundle ? codeFacts(bundle).filter((f) => f.kind !== "watchdog") : null;
}

async function build(slug: string): Promise<Board | null> {
  const t0 = Date.now();
  const bundle = await loadBundle(slug);
  const facts = await factsFor(slug);
  if (!bundle || !facts) return null;
  const statements = statementsFrom(documents(slug));

  // every document statement against the code's testimony, where the fact may rule on it. A short fact can't
  // entail a long claim, so support is also read the other way round: does the claim imply what the code does?
  const pairs: [string, string][] = [];
  const meta: { claim: Statement; against: string; contra: boolean; support: boolean }[] = [];
  const amountMatch = new Map<string, string>();
  const wrongWallet = new Map<string, string>(); // names a recipient wallet the code doesn't pay
  for (const s of statements) {
    for (const f of facts) {
      const contra = canContradict(f, s);
      const support = canSupport(f, s);
      if (support && !f.negative && f.topics[0] === "money" && isAmountClaim(s.text) && sameAmount(f, s)) amountMatch.set(s.id, f.id);
      if (contra && f.topics[0] === "money" && isRecipientClaim(s.text)) {
        const said = walletsIn(s.text);
        const paid = walletsIn(f.text);
        if (said.length && paid.length && !said.some((w) => paid.indexOf(w) >= 0)) wrongWallet.set(s.id, f.id);
      }
      if (!contra && !support) continue;
      pairs.push([f.text, s.text]);
      meta.push({ claim: s, against: f.id, contra, support });
      if (!support) continue;
      pairs.push([s.text, f.text]);
      meta.push({ claim: s, against: f.id, contra: false, support });
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
      if (m.contra && sc.contradiction > cur.contra) Object.assign(cur, { contra: sc.contradiction, contraBy: m.against });
      if (m.support && sc.entailment > cur.entail) Object.assign(cur, { entail: sc.entailment, entailBy: m.against });
      best.set(m.claim.id, cur);
      if (m.contra && sc.contradiction >= CONTRA) links.push({ from: m.against, to: m.claim.id, kind: "contradicts", score: +sc.contradiction.toFixed(3) });
      else if (m.support && sc.entailment >= 0.85) links.push({ from: m.against, to: m.claim.id, kind: "supports", score: +sc.entailment.toFixed(3) });
    });
    for (const s of statements) {
      const b = best.get(s.id) ?? { contra: 0, entail: 0 };
      rulings[s.id] =
        b.contra >= CONTRA
          ? { verdict: "contradicted", score: +b.contra.toFixed(3), evidence: b.contraBy }
          : wrongWallet.has(s.id)
          ? { verdict: "contradicted", score: 1, evidence: wrongWallet.get(s.id), exact: true }
          : b.entail >= ENTAIL
          ? { verdict: "supported", score: +b.entail.toFixed(3), evidence: b.entailBy }
          : amountMatch.has(s.id)
          ? { verdict: "supported", score: 1, evidence: amountMatch.get(s.id), exact: true }
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
    const asStatement = statement(c.id, "pdf", c.text);
    for (const f of facts) {
      if (!canContradict(f, asStatement)) continue;
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

  const code: Statement[] = facts.map((f) => ({ id: f.id, witness: "code" as const, text: f.text, topic: f.topics[0] ?? topicOf(f.text), topics: f.topics }));
  const witnesses = (["code", "pdf", "forum", "social", "disclosure"] as WitnessId[])
    .map((id) => ({ id, label: LABEL[id], statements: id === "code" ? code : statements.filter((s) => s.witness === id) }))
    .filter((w) => w.statements.length > 0);
  return { proposalId: slug, model: scores ? NLI_MODEL : null, ms: Date.now() - t0, witnesses, links, rulings, summarySupport };
}

/**
 * "Try to lie to it": rules on one new sentence. The code's testimony decides first, under the same rules as the
 * board; the documents can confirm it, or overrule it only where both state an amount.
 */
export interface ClaimCheck {
  ruling: Ruling;
  /** the decider first, then the closest other statements */
  evidence: { id: string; text: string; witness: WitnessId; contradiction: number; entailment: number }[];
  model: string | null;
}

export async function checkClaim(slug: string, claim: string): Promise<ClaimCheck | null> {
  const board = await factCheck(slug);
  const facts = await factsFor(slug);
  if (!board || !facts) return null;
  const c = statement("claim", "pdf", claim);
  const docs = board.witnesses.filter((w) => w.id !== "code").flatMap((w) => w.statements);
  const scores = await nliBatch([
    ...facts.map((f): [string, string] => [f.text, claim]),
    ...docs.map((d): [string, string] => [d.text, claim]),
    ...facts.map((f): [string, string] => [claim, f.text]), // does the claim imply what the code does?
  ]);
  if (!scores) return { ruling: { verdict: "unclear", score: 0 }, evidence: [], model: null };

  const amountClaim = isAmountClaim(claim) && !COMMENTARY.test(claim);
  const back = facts.length + docs.length;
  const rows = [
    ...facts.map((f, i) => {
      const sc = { ...scores[i]!, entailment: Math.max(scores[i]!.entailment, scores[back + i]!.entailment) };
      return { id: f.id, text: f.text, witness: "code" as WitnessId, sc, contra: canContradict(f, c), support: canSupport(f, c) };
    }),
    ...docs.map((d, j) => {
      const sc = scores[facts.length + j]!;
      // a statement the code already overruled can't vouch for anything
      const support = board.rulings[d.id]?.verdict !== "contradicted";
      return { id: d.id, text: d.text, witness: d.witness, sc, contra: amountClaim && isAmountClaim(d.text) && sc.contradiction >= 0.9, support };
    }),
    // only signals the rules let count are reported, so the evidence list never shows a score that was ignored
  ].map((r) => ({ ...r, contradiction: r.contra ? +r.sc.contradiction.toFixed(3) : 0, entailment: r.support ? +r.sc.entailment.toFixed(3) : 0 }));
  const ranked = rows.sort((a, b) => Math.max(b.contradiction, b.entailment) - Math.max(a.contradiction, a.entailment));

  // the code outranks the documents: a contradiction by the code decides the case
  const contra = ranked.find((r) => r.witness === "code" && r.contra && r.contradiction >= CONTRA) ?? ranked.find((r) => r.contra && r.contradiction >= CONTRA);
  const support = ranked.find((r) => r.support && r.entailment >= ENTAIL);
  const ruling: Ruling = contra
    ? { verdict: "contradicted", score: contra.contradiction, evidence: contra.id }
    : support
    ? { verdict: "supported", score: support.entailment, evidence: support.id }
    : { verdict: "unclear", score: Math.max(0, ...ranked.map((r) => Math.max(r.contra ? r.contradiction : 0, r.support ? r.entailment : 0))) };
  const decider = ranked.filter((r) => r.id === ruling.evidence);
  const evidence = [...decider, ...ranked.filter((r) => r.id !== ruling.evidence)].slice(0, 4).map(({ id, text, witness, contradiction, entailment }) => ({ id, text, witness, contradiction, entailment }));
  return { ruling, evidence, model: NLI_MODEL };
}
