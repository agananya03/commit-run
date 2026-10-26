import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IntentSpec, SimulationResult, DecisionSummary } from "../src/contracts/schemas.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { assessmentReport } from "../src/verdict/report.js";
import { evaluate } from "../src/verdict/rules.js";

const json = (...p: string[]): unknown => JSON.parse(readFileSync(join(repoRoot, ...p), "utf8"));

function mip21() {
  const sim = SimulationResult.parse(json("shared", "mocks", "simulate.MIP-21.json"));
  const findings = evaluate({ intent: IntentSpec.parse(json("shared", "mocks", "extract-intent.MIP-21.json")), sim, summary: DecisionSummary.parse(json("shared", "mocks", "summarize.MIP-21.json")), coi: null });
  return { sim, findings };
}

describe("technical assessment report", () => {
  it("is deterministic: the same run always hashes the same (anyone can re-check the on-chain hash)", () => {
    const { sim, findings } = mip21();
    const a = assessmentReport("MIP-21", "PROPOSED", sim, findings, 42);
    const b = assessmentReport("MIP-21", "PROPOSED", structuredClone(sim), structuredClone(findings), 42);
    expect(a.reportHash).toBe(b.reportHash);
    expect(a.reportHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("states what the code does and what it promised, and any change moves the hash", () => {
    const { sim, findings } = mip21();
    const r = assessmentReport("MIP-21", "PROPOSED", sim, findings, 42);
    expect(r.markdown).toContain(sim.simHash);
    expect(r.markdown).toMatch(/### Ownership\n\n- owner of/);
    expect(r.markdown).toMatch(/unlimited \(2\^256 − 1\)/);
    expect(r.markdown).toMatch(/CRITICAL ownership_change/);
    expect(assessmentReport("MIP-21", "QUEUED", sim, findings, 42).reportHash).not.toBe(r.reportHash);
    expect(assessmentReport("MIP-21", "PROPOSED", sim, findings.slice(1), 42).reportHash).not.toBe(r.reportHash);
  });
});
