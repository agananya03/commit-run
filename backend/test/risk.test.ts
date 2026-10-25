import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionSummary, IntentSpec, SimulationResult } from "../src/contracts/schemas.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { computeRisk, interpolate, nakamoto, RISK_CONFIG, type Vote } from "../src/risk/chain.js";
import { hardhatAddress } from "../src/seed/scenarios.js";
import { evaluate } from "../src/verdict/rules.js";

const json = (...p: string[]): unknown => JSON.parse(readFileSync(join(repoRoot, ...p), "utf8"));
const votes = (slug: string): Vote[] =>
  (json("data", "scenarios", slug, "votes.json") as { votes: { index: number; weight: string }[] }).votes.map((v) => ({ voter: hardhatAddress(v.index).toLowerCase(), weight: Number(v.weight) }));

function inputFor(slug: string, pCoi: number) {
  const summary = DecisionSummary.parse(json("shared", "mocks", `summarize.${slug}.json`));
  const sim = SimulationResult.parse(json("shared", "mocks", `simulate.${slug}.json`));
  const findings = evaluate({ intent: IntentSpec.parse(json("shared", "mocks", `extract-intent.${slug}.json`)), sim, summary, coi: null });
  const coi = { proposalId: slug, proposer: hardhatAddress(13).toLowerCase(), disclosed: [], signatureValid: pCoi === 0, undisclosedLinks: [], pCoi };
  return { proposalId: slug, summary, coi, votes: votes(slug), totalVotingPower: 100_000_000, findings, simulationSuccess: sim.success };
}

const odds = (p: number) => p / (1 - p);
const prob = (o: number) => o / (1 + o);

describe("risk chain", () => {
  it("MIP-21: 0.05 x 2.5 (1/3 claims unsupported) x 10 (pCoi 0.95) x 1.5 (Nakamoto 3) x 20 (critical) -> CRITICAL, halt", () => {
    const risk = computeRisk(inputFor("MIP-21", 0.95));
    expect(risk.stages.map((s) => [s.stage, s.likelihoodRatio])).toEqual([["claims", 2.5], ["coi", 10], ["voting", 1.5], ["execution", 20]]);
    const o = odds(0.05);
    expect(risk.stages.map((s) => s.probability)).toEqual([prob(o * 2.5), prob(o * 25), prob(o * 37.5), prob(o * 750)].map((p) => Math.round(p * 1000) / 1000));
    expect(risk.posterior).toBeCloseTo(0.975, 3);
    expect(risk).toMatchObject({ prior: 0.05, level: "CRITICAL", action: "halt" });
    const exec = risk.stages.find((s) => s.stage === "execution")!;
    expect(exec.findingIds.length).toBeGreaterThan(0);
  });

  it("MIP-12: 0.05 x 0.5 (all claims supported) x 0.5 (pCoi 0) x 1.5 (Nakamoto 3) x 0.3 (clean execution) -> LOW, none", () => {
    const risk = computeRisk(inputFor("MIP-12", 0));
    expect(risk.stages.map((s) => [s.stage, s.likelihoodRatio])).toEqual([["claims", 0.5], ["coi", 0.5], ["voting", 1.5], ["execution", 0.3]]);
    expect(risk.posterior).toBeCloseTo(prob(odds(0.05) * 0.5 * 0.5 * 1.5 * 0.3), 3); // ≈ 0.006
    expect(risk).toMatchObject({ level: "LOW", action: "none" });
  });

  it("maps pCoi piecewise-linearly and counts the Nakamoto coefficient", () => {
    const pts = RISK_CONFIG.coi;
    [0, 0.25, 0.5, 0.7, 0.9, 0.95, 1].forEach((x, i) => expect(interpolate(pts, x)).toBeCloseTo([0.5, 1.25, 2, 5, 8, 10, 12][i]!, 9));
    expect(nakamoto(votes("MIP-21"), 0.51)).toBe(3);
    expect(nakamoto([{ voter: "a", weight: 1 }, { voter: "b", weight: 1 }], 0.51)).toBe(2);
  });

  it("rewards a healthy, spread-out vote and punishes COI-linked power", () => {
    const spread = Array.from({ length: 20 }, (_, i) => ({ voter: `0x${(i + 1).toString(16).padStart(40, "0")}`, weight: 1_000_000 }));
    const base = { ...inputFor("MIP-12", 0), votes: spread };
    expect(computeRisk(base).stages.find((s) => s.stage === "voting")!.likelihoodRatio).toBe(0.8);
    const linked = spread.slice(0, 5).map((v) => v.voter);
    const coi = { ...base.coi, undisclosedLinks: linked.map((to) => ({ from: base.coi.proposer, to, path: [base.coi.proposer, to], hops: 1, pLink: 0.9, reasons: [] })) };
    expect(computeRisk({ ...base, coi }).stages.find((s) => s.stage === "voting")!.likelihoodRatio).toBe(1.6); // 25% linked: x2, still healthy x0.8
  });
});
