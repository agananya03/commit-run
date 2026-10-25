import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DecisionSummary, IntentSpec, SimulationResult } from "../src/contracts/schemas.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { evaluate } from "../src/verdict/rules.js";

const mock = (name: string): unknown => JSON.parse(readFileSync(join(repoRoot, "shared", "mocks", name), "utf8"));
const inputFor = (slug: string) => ({
  intent: IntentSpec.parse(mock(`extract-intent.${slug}.json`)),
  sim: SimulationResult.parse(mock(`simulate.${slug}.json`)),
  summary: DecisionSummary.parse(mock(`summarize.${slug}.json`)),
  coi: null,
});

describe("verdict rules", () => {
  it("MIP-12 (honest grant) has no critical finding", () => {
    const findings = evaluate(inputFor("MIP-12"));
    expect(findings.filter((f) => f.severity === "critical")).toEqual([]);
  });

  it("MIP-21 shows the ownership change, the unlimited approval and the new privileged functions", () => {
    const findings = evaluate(inputFor("MIP-21"));
    const categories = new Set(findings.map((f) => f.category));
    for (const c of ["ownership_change", "unlimited_approval", "new_privileged_function"] as const) expect(categories.has(c)).toBe(true);
    expect(findings.find((f) => f.category === "ownership_change")).toMatchObject({ severity: "critical", simRef: "ownershipChanges[0]" });
    expect(findings.filter((f) => f.category === "new_privileged_function").map((f) => f.does).join(" ")).toMatch(/migrateReserves.*reinitializeV2/);
    expect(findings[0]!.severity).toBe("critical");
    expect(findings.map((f) => f.id)).toEqual(findings.map((_, i) => `f${i + 1}`));
  });

  it("flags a transfer to an unnamed recipient and a >1% amount difference", () => {
    const base = inputFor("MIP-12");
    const wrongTo = { ...base, sim: { ...base.sim, tokenTransfers: [{ ...base.sim.tokenTransfers[0]!, to: "0x000000000000000000000000000000000000dEaD" }] } };
    expect(evaluate(wrongTo).map((f) => f.category)).toContain("recipient_mismatch");
    const more = { ...base, sim: { ...base.sim, tokenTransfers: [{ ...base.sim.tokenTransfers[0]!, amount: "500000000000" }] } };
    expect(evaluate(more).map((f) => f.category)).toContain("amount_mismatch");
  });
});
