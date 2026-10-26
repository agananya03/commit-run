import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionSummary, IntentSpec, SimulationResult } from "../src/contracts/schemas.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { FactCheckBoard, FactCheckClient, summarizeBoard } from "../src/clients/factCheckClient.js";
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

  it("claims stage: the NLI fact-check replaces the RAG labels when it ran", () => {
    const factCheck = { model: "nli", statements: 20, contradicted: 4, confirmed: 2, caught: [{ claim: "Changes are limited to slot packing.", witness: "Proposal", evidence: "The upgrade adds new admin powers." }] };
    const claims = (fc: typeof factCheck | null) => computeRisk({ ...inputFor("MIP-21", 0.95), factCheck: fc }).stages[0]!;
    expect(claims(factCheck).likelihoodRatio).toBe(6.3); // 0.5 + 1.5×4 − 0.1×2
    expect(claims(factCheck).explanation).toMatch(/NLI fact-check .* 4 contradicted .*slot packing/);
    expect(claims({ ...factCheck, contradicted: 0, confirmed: 12 }).likelihoodRatio).toBe(0.4); // clamped
    expect(claims({ ...factCheck, contradicted: 9 }).likelihoodRatio).toBe(10); // clamped
    // no fact-check, or nothing to check: the RAG labels as before
    expect(claims(null).likelihoodRatio).toBe(2.5);
    expect(claims({ ...factCheck, statements: 0 }).likelihoodRatio).toBe(2.5);
  });

  it("summarizes the shared fact-check mocks: MIP-17 caught twice, MIP-12 clean", async () => {
    const board = (slug: string) => FactCheckBoard.parse(json("shared", "mocks", `factcheck.${slug}.json`));
    const mip17 = summarizeBoard(board("MIP-17"))!;
    expect(mip17).toMatchObject({ statements: 20, contradicted: 2 });
    expect(mip17.caught.map((c) => c.claim).join(" ")).toMatch(/\$3,500,000/);
    expect(summarizeBoard(board("MIP-12"))).toMatchObject({ contradicted: 0 });
    expect(summarizeBoard({ ...board("MIP-12"), model: null })).toBeNull(); // model didn't run: no summary

    const logger = { warn: () => {}, debug: () => {} };
    const client = new FactCheckClient({ baseURL: "http://127.0.0.1:9", timeoutMs: 500, useMocks: true, mocksDir: join(repoRoot, "shared", "mocks"), logger });
    expect(await client.summary("MIP-21")).toMatchObject({ contradicted: 4 });
    expect(await client.summary("MIP-99")).toBeNull(); // no mock, no service: the stage falls back
  });

  it("the demo bundles' risk levels (npm run mocks:factcheck) match the scenario answer keys", () => {
    for (const slug of ["MIP-12", "MIP-17", "MIP-21"]) {
      const expected = (json("data", "scenarios", slug, "expected.json") as { riskLevel: string }).riskLevel;
      const bundle = json("frontend", "public", "mocks-local", `proposal-bundle.${slug}.json`) as { risk: { level: string } };
      expect(bundle.risk.level, slug).toBe(expected);
    }
    // a bad-but-honestly-executed grant: HIGH between 40% and 90%, CRITICAL from 90%
    expect(RISK_CONFIG.levels.HIGH).toBe(0.9);
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
