// 4-stage probabilistic risk chain: claims -> COI -> voting -> execution, combined as likelihood ratios in log-odds space.
import type { z } from "zod";
import type { CoiReport, DecisionSummary, Finding, RiskChain } from "../contracts/schemas.js";

type FindingT = z.infer<typeof Finding>;
type RiskChainT = z.infer<typeof RiskChain>;
type StageT = RiskChainT["stages"][number];

/** Every number of the model in one place. */
export const RISK_CONFIG = {
  /** P(malicious) before looking at anything. */
  prior: 0.05,
  claims: {
    base: 0.5,
    perUnsupportedShare: 6,
    perContradictedShare: 4,
    min: 0.5,
    max: 10,
  },
  /** Piecewise-linear pCoi -> LR. */
  coi: [
    [0, 0.5],
    [0.5, 2],
    [0.9, 8],
    [1, 12],
  ] as [number, number][],
  voting: {
    base: 1,
    /** Nakamoto coefficient: fewest voters whose combined weight exceeds `majority` of the votes cast. */
    majority: 0.51,
    concentratedNakamoto: 4,
    concentratedFactor: 1.5,
    coiPowerShare: 0.2,
    coiPowerFactor: 2,
    healthyTurnout: 0.2,
    healthyNakamoto: 10,
    healthyFactor: 0.8,
  },
  execution: { critical: 20, high: 5, clean: 0.3, otherwise: 1 },
  /** posterior < LOW -> LOW, < MEDIUM -> MEDIUM, < HIGH -> HIGH, else CRITICAL */
  levels: { LOW: 0.1, MEDIUM: 0.4, HIGH: 0.8 },
} as const;

export type RiskConfig = typeof RISK_CONFIG;

/** Findings about what the code does (the rest belong to the claims and COI stages). */
export const EXECUTION_CATEGORIES = new Set<FindingT["category"]>([
  "recipient_mismatch",
  "amount_mismatch",
  "undeclared_action",
  "ownership_change",
  "unlimited_approval",
  "new_privileged_function",
]);

export interface Vote {
  voter: string;
  /** Any unit, as long as totalVotingPower uses the same one. */
  weight: number;
}

export interface RiskInput {
  proposalId: string;
  summary: z.infer<typeof DecisionSummary> | null;
  coi: z.infer<typeof CoiReport> | null;
  votes: Vote[];
  /** Same unit as Vote.weight; turnout = Σ weight / totalVotingPower. */
  totalVotingPower: number;
  findings: FindingT[];
  /** null when no simulation ran. */
  simulationSuccess: boolean | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function interpolate(points: [number, number][], x: number): number {
  const xs = clamp(x, points[0]![0], points.at(-1)![0]);
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    if (xs <= x1) return y0 + ((y1 - y0) * (xs - x0)) / (x1 - x0);
  }
  return points.at(-1)![1];
}

/** Fewest voters (largest first) whose weight exceeds `majority` of all weight cast; 0 if nobody voted. */
export function nakamoto(votes: Vote[], majority: number): number {
  const sorted = votes.map((v) => v.weight).sort((a, b) => b - a);
  const total = sorted.reduce((s, w) => s + w, 0);
  if (total === 0) return 0;
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i]!;
    if (sum > total * majority) return i + 1;
  }
  return sorted.length;
}

type StageCore = Omit<StageT, "probability">;

function claimsStage(input: RiskInput, c: RiskConfig["claims"]): StageCore {
  const claims = input.summary?.claims ?? [];
  const ids = input.findings.filter((f) => f.category === "unsupported_claim" || f.category === "contradiction").map((f) => f.id);
  if (claims.length === 0) return { stage: "claims", likelihoodRatio: 1, explanation: "No claims extracted; the claims stage is neutral.", findingIds: ids };
  const unsupported = claims.filter((x) => x.support === "unsupported").length / claims.length;
  const contradicted = claims.filter((x) => x.support === "contradicted").length / claims.length;
  const lr = clamp(c.base + c.perUnsupportedShare * unsupported + c.perContradictedShare * contradicted, c.min, c.max);
  return {
    stage: "claims",
    likelihoodRatio: r3(lr),
    explanation: `${claims.length} claims: ${pct(unsupported)} unsupported, ${pct(contradicted)} contradicted by independent evidence. LR = ${c.base} + ${c.perUnsupportedShare}×${r3(unsupported)} + ${c.perContradictedShare}×${r3(contradicted)} = ${r3(lr)}.`,
    findingIds: ids,
  };
}

function coiStage(input: RiskInput, points: RiskConfig["coi"]): StageCore {
  const ids = input.findings.filter((f) => f.category === "coi").map((f) => f.id);
  if (!input.coi) return { stage: "coi", likelihoodRatio: 1, explanation: "No COI report; the COI stage is neutral.", findingIds: ids };
  const lr = interpolate(points, input.coi.pCoi);
  const links = input.coi.undisclosedLinks.length;
  const disclosure = input.coi.signatureValid ? "a validly signed disclosure" : "no validly signed disclosure";
  return {
    stage: "coi",
    likelihoodRatio: r3(lr),
    explanation: `pCoi ${r3(input.coi.pCoi)} from ${links} undisclosed wallet link${links === 1 ? "" : "s"} (${disclosure}) maps to LR ${r3(lr)}.`,
    findingIds: ids,
  };
}

function votingStage(input: RiskInput, v: RiskConfig["voting"]): StageCore {
  if (input.votes.length === 0) return { stage: "voting", likelihoodRatio: 1, explanation: "No votes cast yet; the voting stage is neutral.", findingIds: [] };
  const cast = input.votes.reduce((s, x) => s + x.weight, 0);
  const n = nakamoto(input.votes, v.majority);
  // Voters the COI engine links to the proposer (as a link endpoint or anywhere on its path)
  const linked = new Set((input.coi?.undisclosedLinks ?? []).flatMap((l) => [l.to, ...l.path]).map((a) => a.toLowerCase()));
  linked.delete(input.coi?.proposer.toLowerCase() ?? "");
  const coiPower = input.votes.filter((x) => linked.has(x.voter.toLowerCase())).reduce((s, x) => s + x.weight, 0) / cast;
  const turnout = input.totalVotingPower > 0 ? cast / input.totalVotingPower : 0;

  let lr = v.base;
  const why: string[] = [`Nakamoto coefficient ${n} (voters needed for ${pct(v.majority)} of ${input.votes.length} votes)`, `turnout ${pct(turnout)}`, `COI-linked voting power ${pct(coiPower)}`];
  if (n <= v.concentratedNakamoto) {
    lr *= v.concentratedFactor;
    why.push(`concentrated (≤ ${v.concentratedNakamoto}) ×${v.concentratedFactor}`);
  }
  if (coiPower > v.coiPowerShare) {
    lr *= v.coiPowerFactor;
    why.push(`COI-linked power > ${pct(v.coiPowerShare)} ×${v.coiPowerFactor}`);
  }
  if (turnout >= v.healthyTurnout && n > v.healthyNakamoto) {
    lr *= v.healthyFactor;
    why.push(`healthy turnout and spread ×${v.healthyFactor}`);
  }
  return { stage: "voting", likelihoodRatio: r3(lr), explanation: `${why.join("; ")}. LR ${r3(lr)}.`, findingIds: [] };
}

function executionStage(input: RiskInput, e: RiskConfig["execution"]): StageCore {
  const exec = input.findings.filter((f) => EXECUTION_CATEGORIES.has(f.category));
  const ids = exec.map((f) => f.id);
  const critical = exec.filter((f) => f.severity === "critical");
  const high = exec.filter((f) => f.severity === "high");
  if (critical.length > 0) return { stage: "execution", likelihoodRatio: e.critical, explanation: `${critical.length} critical execution finding(s): ${[...new Set(critical.map((f) => f.category))].join(", ")}. LR ${e.critical}.`, findingIds: ids };
  if (high.length > 0) return { stage: "execution", likelihoodRatio: e.high, explanation: `${high.length} high execution finding(s): ${[...new Set(high.map((f) => f.category))].join(", ")}. LR ${e.high}.`, findingIds: ids };
  if (input.simulationSuccess && exec.length === 0) return { stage: "execution", likelihoodRatio: e.clean, explanation: `The simulated execution matches the stated intent with zero findings. LR ${e.clean}.`, findingIds: [] };
  const why = input.simulationSuccess === null ? "No simulation yet" : input.simulationSuccess ? `${exec.length} minor execution finding(s)` : "The simulation reverted";
  return { stage: "execution", likelihoodRatio: e.otherwise, explanation: `${why}; the execution stage is neutral.`, findingIds: ids };
}

/** Runs the four stages in order; each stage's probability is the running posterior after it. */
export function computeRisk(input: RiskInput, config: RiskConfig = RISK_CONFIG): RiskChainT {
  const cores = [claimsStage(input, config.claims), coiStage(input, config.coi), votingStage(input, config.voting), executionStage(input, config.execution)];
  let logOdds = logit(config.prior);
  const stages = cores.map((s) => {
    logOdds += Math.log(s.likelihoodRatio);
    return { ...s, probability: r3(sigmoid(logOdds)) };
  });
  const posterior = sigmoid(logOdds);
  const { levels } = config;
  const level = posterior < levels.LOW ? "LOW" : posterior < levels.MEDIUM ? "MEDIUM" : posterior < levels.HIGH ? "HIGH" : "CRITICAL";
  const criticalExecution = input.findings.some((f) => EXECUTION_CATEGORIES.has(f.category) && f.severity === "critical");
  const action = level === "CRITICAL" || criticalExecution ? "halt" : level === "HIGH" ? "review" : "none";
  return { proposalId: input.proposalId, prior: config.prior, stages, posterior: r3(posterior), level, action };
}
