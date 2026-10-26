// Demo mode has no chain: this gives each frontend mock bundle the EvidenceBound and AssessmentAttested events a
// live run would produce, and writes the assessment report the AssessmentAttested hash was taken of
// (frontend/public/mocks-local/assessment.<slug>.md), so the History tab's "re-hash the report" works offline.
// The mock versions are synthetic, so the bound root is the bundle's own latest version root (live runs bind the
// real Merkle root of the files). Idempotent.
//
//   npm run mocks:evidence
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { id as keccakId } from "ethers";
import { Finding, SimulationResult } from "../src/contracts/schemas.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { hardhatAddress } from "../src/seed/scenarios.js";
import { assessmentReport } from "../src/verdict/report.js";
import { assessmentUri } from "../src/verdict/assessment.js";

type Event = { proposalId: string | null; contract: string; name: string; args: Record<string, unknown>; blockNumber: number; txHash: string; logIndex: number };
const MINE = new Set(["EvidenceBound", "AssessmentAttested"]);
const dir = join(repoRoot, "frontend", "public", "mocks-local");

for (const slug of ["MIP-12", "MIP-17", "MIP-21"]) {
  const file = join(dir, `proposal-bundle.${slug}.json`);
  const bundle = JSON.parse(readFileSync(file, "utf8")) as {
    proposal: { proposer: string; governorProposalId?: string | null };
    versions: { evidenceRoot: string }[];
    simulation: unknown;
    findings: unknown[];
    chainEvents: Event[];
  };
  const disclosure = JSON.parse(readFileSync(join(repoRoot, "data", "scenarios", slug, "disclosure.json"), "utf8")) as { walletIndices?: number[] };
  const events = bundle.chainEvents.filter((e) => !MINE.has(e.name));
  const created = events.find((e) => e.name === "ProposalCreated");
  const block = created?.blockNumber ?? 2000;
  const tx = (name: string) => keccakId(`${slug}:${name}`);

  events.push({
    proposalId: slug,
    contract: "MeridianGovernor",
    name: "EvidenceBound",
    args: {
      proposalId: bundle.proposal.governorProposalId ?? null,
      proposer: bundle.proposal.proposer,
      evidenceRoot: bundle.versions.at(-1)!.evidenceRoot,
      disclosedWallets: (disclosure.walletIndices ?? []).map((i) => hardhatAddress(i)),
      disclosureUri: `data/scenarios/${slug}/disclosure.json`,
    },
    blockNumber: block,
    txHash: created?.txHash ?? tx("EvidenceBound"), // emitted in the same transaction as ProposalCreated
    logIndex: (created?.logIndex ?? 0) + 1,
  });

  const parsed = SimulationResult.safeParse(bundle.simulation);
  if (bundle.simulation) {
    const sim = (parsed.success ? parsed.data : bundle.simulation) as Parameters<typeof assessmentReport>[2];
    const report = assessmentReport(slug, "PROPOSED", sim, bundle.findings.map((f) => Finding.parse(f)), null);
    writeFileSync(join(dir, `assessment.${slug}.md`), report.markdown);
    events.push({
      proposalId: slug,
      contract: "ProposalRegistry",
      name: "AssessmentAttested",
      args: { proposalId: slug.split("-")[1], index: 0, reportHash: report.reportHash, simHash: sim.simHash, uri: assessmentUri(slug, sim.simHash), attester: hardhatAddress(0) },
      blockNumber: block + 1,
      txHash: tx("AssessmentAttested"),
      logIndex: 0,
    });
    console.log(`${slug}: report ${report.reportHash.slice(0, 14)}… (${parsed.success ? "sim parsed" : "sim used as-is"}), disclosed ${disclosure.walletIndices?.join(", ") ?? "none"}`);
  }
  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  writeFileSync(file, `${JSON.stringify({ ...bundle, chainEvents: events }, null, 2)}\n`);
}
