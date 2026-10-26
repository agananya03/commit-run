// Checks the evidence-binding and assessment pieces against a live node (no database needed):
//   RPC_URL=http://127.0.0.1:8545 npx tsx scripts/check-evidence-chain.ts MIP-21
// Needs deploy:seed and `npm run gov -- propose <slug>` in /contracts first. Commits a version (if the registry has
// none), attests the scenario's technical assessment, and verifies the Governor's EvidenceBound root and disclosure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, Interface, JsonRpcProvider, Network, NonceManager, Wallet, ZeroHash } from "ethers";
import { proposalNumericId, RegistryClient } from "../src/chain/registry.js";
import { DecisionSummary, IntentSpec, SimulationResult } from "../src/contracts/schemas.js";
import { buildEvidenceTree } from "../src/integrity/merkle.js";
import { repoRoot } from "../src/loadRootEnv.js";
import { planScenario } from "../src/seed/scenarios.js";
import { assessmentReport } from "../src/verdict/report.js";
import { evaluate } from "../src/verdict/rules.js";

const slug = process.argv[2] ?? "MIP-21";
const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
// cacheTimeout -1: ethers otherwise answers the identical before/after log queries from a 250 ms cache
const provider = new JsonRpcProvider(rpc, Network.from(31337), { staticNetwork: true, cacheTimeout: -1 });
const deployments = JSON.parse(readFileSync(join(repoRoot, "contracts", "deployments", "localhost.json"), "utf8")) as { contracts: Record<string, { address: string; abi: unknown[] }> };
const json = (...p: string[]): unknown => JSON.parse(readFileSync(join(repoRoot, ...p), "utf8"));
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) process.exitCode = 1;
};

// Hardhat account #0: the backend's committer (public test key, local chain only)
const signer = new NonceManager(new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider));
const reg = deployments.contracts.ProposalRegistry!;
const registry = new RegistryClient(new Contract(reg.address, reg.abi as never, signer), signer, rpc);
const id = proposalNumericId(slug);

// 1. the evidence root the backend commits for version 1 of the scenario
const plan = planScenario(join(repoRoot, "data", "scenarios", slug), slug, repoRoot);
const root = buildEvidenceTree(plan.files).root;
if ((await registry.latestVersionHash(id)) === ZeroHash) await registry.commit({ proposalNumericId: id, versionHash: root, prevHash: ZeroHash, evidenceRoot: root, uri: `poi://${slug}/v1` });
const commits = await registry.commits(id);
ok(commits.some((c) => c.evidenceRoot === root.toLowerCase()), `${slug} has a committed version with evidenceRoot ${root.slice(0, 12)}…`);

// 2. the Governor proposal is bound to that same root, with the proposer's disclosure
const gov = deployments.contracts.MeridianGovernor!;
const iface = new Interface(gov.abi as never);
const logs = await provider.getLogs({ address: gov.address, topics: [iface.getEvent("EvidenceBound")!.topicHash], fromBlock: 0, toBlock: "latest" });
const bound = logs.map((l) => iface.parseLog(l)!).find((e) => (e.args.evidenceRoot as string).toLowerCase() === root.toLowerCase());
ok(Boolean(bound), "a Governor proposal carries EvidenceBound with the committed root (the vote is about this evidence)");
if (bound) {
  const wallets = (bound.args.disclosedWallets as string[]).map((w) => w.toLowerCase());
  ok(wallets.includes(plan.proposer), `the proposer's own on-chain disclosure names ${wallets.length} wallet(s), including the proposer`);
  const description = (await provider.getLogs({ address: gov.address, topics: [iface.getEvent("ProposalCreated")!.topicHash], fromBlock: 0, toBlock: "latest" }))
    .map((l) => iface.parseLog(l)!)
    .find((e) => (e.args.proposalId as bigint) === (bound.args.proposalId as bigint))?.args.description as string;
  ok(description?.endsWith(`evidence: ${root.toLowerCase()}`), "the stored description ends with the evidence root, so the proposal id hashes it");
}

// 3. the technical assessment goes on the record and reads back
const sim = SimulationResult.parse(json("shared", "mocks", `simulate.${slug}.json`));
const findings = evaluate({ intent: IntentSpec.parse(json("shared", "mocks", `extract-intent.${slug}.json`)), sim, summary: DecisionSummary.parse(json("shared", "mocks", `summarize.${slug}.json`)), coi: null });
const report = assessmentReport(slug, "PROPOSED", sim, findings, null);
const before = (await registry.assessments(id)).length;
if (!(await registry.assessments(id)).some((a) => a.reportHash === report.reportHash)) await registry.attest(id, report.reportHash, sim.simHash, `poi://${slug}/assessment/${sim.simHash}`);
const after = await registry.assessments(id);
ok(after.some((a) => a.reportHash === report.reportHash && a.simHash === sim.simHash.toLowerCase()), `assessment attested (${before} -> ${after.length} on record), reportHash ${report.reportHash.slice(0, 12)}…`);
