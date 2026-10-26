// Snapshots the NLI fact-check board of each demo proposal into /shared/mocks (the backend's fallback when the
// frontend isn't running), then recomputes each frontend mock bundle's risk chain with the backend's own
// computeRisk, so demo mode shows exactly what the live pipeline would.
//
//   npm run mocks:factcheck            (needs the frontend on FACTCHECK_URL, default http://localhost:3000)
//   npm run mocks:factcheck -- --dry   (print the new risk chains, write nothing)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactCheckBoard, summarizeBoard } from "../src/clients/factCheckClient.js";
import { CoiReport, DecisionSummary, Finding } from "../src/contracts/schemas.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { computeRisk } from "../src/risk/chain.js";
import { TOTAL_SUPPLY_MRD, votesOf } from "../src/risk/service.js";

const SLUGS = ["MIP-12", "MIP-17", "MIP-21"];
const dry = process.argv.includes("--dry");
const base = process.env.FACTCHECK_URL ?? "http://localhost:3000";

for (const slug of SLUGS) {
  const res = await fetch(`${base}/api/factcheck`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ proposalId: slug }) });
  if (!res.ok) throw new Error(`${slug}: fact-check HTTP ${res.status}; is the frontend running on ${base}?`);
  const board = FactCheckBoard.parse(await res.json());
  const factCheck = summarizeBoard(board);
  if (!factCheck) throw new Error(`${slug}: the NLI model didn't run (board.model is null)`);

  const bundleFile = join(repoRoot, "frontend", "public", "mocks-local", `proposal-bundle.${slug}.json`);
  const bundle = JSON.parse(readFileSync(bundleFile, "utf8")) as Record<string, unknown> & { risk?: { posterior: number; level: string } };
  const coi = CoiReport.safeParse(bundle.coi);
  const summary = DecisionSummary.safeParse(bundle.summary);
  const sim = bundle.simulation as { success?: boolean } | null;
  const events = ((bundle.chainEvents as { name: string; args: unknown }[] | undefined) ?? []).filter((e) => e.name === "VoteCast");
  const risk = computeRisk({
    proposalId: slug,
    summary: summary.success ? summary.data : null,
    factCheck,
    coi: coi.success ? coi.data : null,
    votes: votesOf(events),
    totalVotingPower: TOTAL_SUPPLY_MRD,
    findings: ((bundle.findings as unknown[]) ?? []).map((f) => Finding.parse(f)),
    simulationSuccess: sim?.success ?? null,
  });

  const was = bundle.risk ? `${bundle.risk.level} ${Math.round(bundle.risk.posterior * 100)}%` : "none";
  console.log(`${slug}: ${factCheck.contradicted}/${factCheck.statements} claims contradicted, ${factCheck.confirmed} confirmed. Risk ${was} -> ${risk.level} ${Math.round(risk.posterior * 100)}% (${risk.action})`);
  for (const s of risk.stages) console.log(`   ${s.stage.padEnd(9)} LR ${String(s.likelihoodRatio).padEnd(6)} -> ${Math.round(s.probability * 100)}%  ${s.explanation.slice(0, 110)}`);
  if (!coi.success) console.log("   (bundle coi doesn't match CoiReport; COI stage neutral)");
  if (dry) continue;

  writeFileSync(join(repoRoot, "shared", "mocks", `factcheck.${slug}.json`), `${JSON.stringify(board, null, 2)}\n`);
  writeFileSync(bundleFile, `${JSON.stringify({ ...bundle, risk }, null, 2)}\n`);
  // the proposal list shows the same level as the bundle
  const listFile = join(repoRoot, "frontend", "public", "mocks-local", "proposals.json");
  const list = JSON.parse(readFileSync(listFile, "utf8")) as { slug: string; riskLevel?: string }[];
  writeFileSync(listFile, `${JSON.stringify(list.map((p) => (p.slug === slug ? { ...p, riskLevel: risk.level } : p)), null, 2)}\n`);
}
if (!dry) console.log("wrote shared/mocks/factcheck.<slug>.json and refreshed the risk in frontend/public/mocks-local bundles");
