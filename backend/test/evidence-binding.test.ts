import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scenarioEvidence } from "../../contracts/scripts/lib/evidence.js";
import { buildEvidenceTree } from "../src/integrity/merkle.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { hardhatAddress, planScenario } from "../src/seed/scenarios.js";

// The proposer binds an evidence root to MeridianGovernor.proposeWithEvidence (contracts/scripts/lib/evidence.ts);
// the backend commits its own evidenceRoot to ProposalRegistry. They must be the same number, or the
// binding check (integrity/binding.ts) would call every honest proposal a mismatch.
describe("evidence binding", () => {
  it.each(["MIP-12", "MIP-17", "MIP-21"])("%s: the root a proposer binds equals the root the backend commits", (slug) => {
    const plan = planScenario(join(repoRoot, "data", "scenarios", slug), slug, repoRoot);
    const bound = scenarioEvidence(repoRoot, slug);
    expect(bound.evidenceRoot).toBe(buildEvidenceTree(plan.files).root);
    expect(bound.disclosedWallets.map((a) => a.toLowerCase())).toContain(plan.proposer);
  });

  it("MIP-21's on-chain disclosure omits the alt wallet the money trail finds", () => {
    expect(scenarioEvidence(repoRoot, "MIP-21").disclosedWallets).not.toContain(hardhatAddress(14));
  });
});
