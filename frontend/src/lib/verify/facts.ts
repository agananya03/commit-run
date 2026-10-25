/**
 * "The code testifies": deterministic plain-English sentences describing what the proposal's code actually does
 * when simulated, plus the money-trail and watchdog facts. No LLM writes these, so the strongest witness can't
 * hallucinate. Negative facts ("No token approvals are granted") let NLI confirm honest proposals, not just
 * fail to contradict them.
 */
import { nameOf } from "@/lib/promiseVsCode";
import type { ProposalBundle } from "@/types/shared";

export interface Fact {
  id: string;
  text: string;
  /** where the fact comes from */
  kind: "code" | "money" | "watchdog";
  /** claim topics this fact can rule on (NLI calls unrelated same-subject sentences "contradictions") */
  topics: string[];
}

const TOPICS = {
  // first topic = what the fact is about; the rest it may rule on only for claims that rule things out
  ownership: ["ownership", "code"],
  approvals: ["approvals", "money", "ownership", "code"],
  money: ["money"],
  code: ["code", "ownership"],
  people: ["people", "money"],
  status: [] as string[],
};

const MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

function amount(raw: string, token: string): string {
  if (raw === MAX) return "an unlimited amount of";
  const usdc = nameOf(token) === "USDC";
  const n = Number(BigInt(raw) / BigInt(`1${"0".repeat(usdc ? 4 : 16)}`)) / 100; // ES5 target: no bigint **
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${usdc ? "USDC" : nameOf(token)}${usdc ? ` ($${n.toLocaleString("en-US", { maximumFractionDigits: 0 })})` : ""}`;
}

export function codeFacts(b: ProposalBundle): Fact[] {
  const out: Fact[] = [];
  const add = (kind: Fact["kind"], text: string, topics: string[]) => out.push({ id: `fact-${out.length + 1}`, text, kind, topics });
  const s = b.simulation;

  if (s) {
    for (const o of s.ownershipChanges) {
      add("code", `The owner of the ${nameOf(o.contract)} changes from ${nameOf(o.before)} to ${nameOf(o.after)}.`, TOPICS.ownership);
      add("code", `Ownership of the ${nameOf(o.contract)} changes to a new wallet.`, TOPICS.ownership);
    }
    if (s.ownershipChanges.length === 0) add("code", "Ownership does not change: no contract gets a new owner.", TOPICS.ownership);

    for (const a of s.approvals) add("code", `The ${nameOf(a.owner)} allows ${nameOf(a.spender)} to spend ${amount(a.amount, a.token)} of its ${nameOf(a.token)}.`, TOPICS.approvals);
    if (s.approvals.length === 0) add("code", "No token approvals are granted to anyone.", TOPICS.approvals);

    for (const t of s.tokenTransfers) add("code", `The ${nameOf(t.from)} sends ${amount(t.amount, t.token)} to ${nameOf(t.to)}.`, TOPICS.money);
    if (s.tokenTransfers.length === 0) add("code", "No money leaves the treasury.", TOPICS.money);

    for (const i of s.implementationChanges) {
      add("code", `The ${nameOf(i.proxy)} is upgraded to new code.`, TOPICS.code);
      if (i.addedSelectors.length) {
        add("code", `The new code adds functions that were not there before: ${i.addedSelectors.map((x) => (x.signature ?? x.selector).split("(")[0]).join(", ")}.`, TOPICS.code);
        add("code", "The upgrade adds new admin powers.", TOPICS.code);
      }
    }
    if (s.implementationChanges.length === 0) add("code", "No contract code is changed or upgraded.", TOPICS.code);
  }

  const coi = b.coi;
  if (coi) {
    for (const l of coi.undisclosedLinks) add("money", `The proposer secretly funded ${nameOf(l.to)} before the proposal, and did not disclose it.`, TOPICS.people);
    if (coi.undisclosedLinks.length === 0) add("money", "The proposer has no hidden financial links to whoever gets paid.", TOPICS.people);
  }

  if (b.flag) add("watchdog", `The watchdog froze ${b.proposal.slug} on-chain before it could run.`, TOPICS.status);
  else add("watchdog", `${b.proposal.slug} has not been frozen by the watchdog.`, TOPICS.status);
  if (b.risk) add("watchdog", `${b.proposal.slug} is rated ${b.risk.level} risk: ${Math.round(b.risk.posterior * 100)}% likely to be harmful.`, TOPICS.status);
  return out;
}
