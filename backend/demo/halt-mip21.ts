/**
 * Live demo: MIP-21 passes a vote, gets queued, and the watchdog halts it before the timelock delay ends.
 *
 *   npm run demo:halt            (backend on :4000, Hardhat node on :8545 with deploy:seed applied, sim on :4002)
 *
 * 1. makes sure the backend knows MIP-21 and has analysed it (POST /proposals, POST /proposals/MIP-21/run)
 * 2. proposes from the proposer (#13), mines past the voting delay, casts data/scenarios/MIP-21/votes.json, mines
 *    past the voting period and queues it in the GuardedTimelock
 * 3. waits for the watchdog:flag Socket.IO event (and GovernanceGuard.isFlagged) and prints how long it took
 * 4. moves time past the delay and tries to execute: the timelock reverts with GuardFlagged
 *
 * Resumes from wherever MIP-21 is on-chain. Same description as contracts/scripts/governance.ts, so both scripts
 * address the same Governor proposal. Hardhat mnemonic keys only: local chain only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, ethers, HDNodeWallet, JsonRpcProvider, NonceManager, type ContractTransactionResponse, type InterfaceAbi, type LogDescription } from "ethers";
import { io } from "socket.io-client";
import type { ProposalBundle, WatchdogFlag } from "../../shared/schemas/types.js";
import { boundDescription, scenarioEvidence } from "../../contracts/scripts/lib/evidence.js";
import { encodeActions } from "../src/chain/actions.js";
import { loadRootEnv, repoRoot } from "../src/loadRootEnv.js";

loadRootEnv();
const SLUG = "MIP-21";
const BACKEND = process.env.BACKEND_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const MNEMONIC = "test test test test test test test test test test test junk";
const STATES = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"] as const;
const SUPPORT: Record<string, number> = { against: 0, for: 1, abstain: 2 };

const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
const deployments = JSON.parse(readFileSync(join(repoRoot, "contracts", "deployments", "localhost.json"), "utf8")) as { contracts: Record<string, { address: string; abi: InterfaceAbi }>; chainId: number; deployBlock: number };
const signers = new Map<number, NonceManager>();
const signer = (i: number) => signers.get(i) ?? signers.set(i, new NonceManager(HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).connect(provider))).get(i)!;
const contract = (name: string, runner: ethers.ContractRunner = provider) => new Contract(deployments.contracts[name]!.address, deployments.contracts[name]!.abi, runner);
const governor = contract("MeridianGovernor");
const timelock = contract("GuardedTimelock");
const guard = contract("GovernanceGuard");

const t0 = Date.now();
const say = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BACKEND}${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: (await res.json()) as T };
}

/** Backend side: MIP-21 registered and analysed (intent + findings + risk), so the watchdog has a baseline. */
async function prepareBackend(): Promise<ProposalBundle> {
  try {
    await api("GET", "/health");
  } catch {
    throw new Error(`backend is not reachable at ${BACKEND}; start it with \`npm run dev\` in /backend`);
  }
  let bundle = await api<ProposalBundle>("GET", `/proposals/${SLUG}`);
  if (bundle.status === 404) {
    say(`registering ${SLUG} in the backend`);
    await api("POST", "/proposals", { slug: SLUG });
    bundle = await api<ProposalBundle>("GET", `/proposals/${SLUG}`);
  }
  if (!bundle.body.risk) {
    say(`running the analysis pipeline for ${SLUG} (ingest → summarize/intent → commit → simulate → coi → verdict → risk)`);
    const run = await api<{ error?: { message: string } }>("POST", `/proposals/${SLUG}/run`);
    if (run.status >= 400 && run.status !== 409) throw new Error(`POST /run failed: ${run.body.error?.message}`);
    for (let i = 0; i < 240 && !bundle.body.risk; i++) {
      await sleep(500);
      bundle = await api<ProposalBundle>("GET", `/proposals/${SLUG}`);
    }
    if (!bundle.body.risk) throw new Error("pipeline did not finish within 2 minutes; check the backend logs and /queues");
  }
  const r = bundle.body.risk!;
  say(`baseline (forum calldata): risk ${r.level}, posterior ${r.posterior}, action ${r.action}, ${bundle.body.findings.length} findings`);
  return bundle.body;
}

async function stateOf(id: bigint): Promise<(typeof STATES)[number] | null> {
  try {
    return STATES[Number(await governor.getFunction("state")(id))] ?? null;
  } catch {
    return null;
  }
}

async function mine(blocks: number, seconds = 0) {
  if (seconds > 0) await provider.send("evm_increaseTime", [seconds]);
  await provider.send("hardhat_mine", [ethers.toQuantity(Math.max(blocks, 1))]);
}

async function main() {
  const bundle = await prepareBackend();
  const latest = bundle.versions.at(-1)!;
  const actions = (latest.canonicalJson as { onchainActions?: unknown }).onchainActions;
  const { targets, values, calldatas } = encodeActions(actions, deployments as never, SLUG);
  const forum = JSON.parse(readFileSync(join(repoRoot, "data", "scenarios", SLUG, "forum_thread.json"), "utf8")) as { title?: string };
  const description = `# ${SLUG}: ${(forum.title ?? SLUG).replace(/^\[[^\]]+\]\s*/, "")}`;
  // MeridianGovernor only takes proposals with evidence and a disclosure; the vote hashes the bound description
  const evidence = scenarioEvidence(repoRoot, SLUG);
  const descriptionHash = ethers.id(boundDescription(description, evidence.evidenceRoot));
  const id = (await governor.getFunction("hashProposal")(targets, values, calldatas, descriptionHash)) as bigint;
  const proposerIndex = 13;

  let state = await stateOf(id);
  say(`${SLUG} on-chain: ${state ?? "not proposed"}`);
  if (state === "Executed" || state === "Defeated" || state === "Canceled" || state === "Expired") {
    say(`nothing to demo: the proposal is ${state}. Reset the chain (restart \`npm run node\`, then \`npm run deploy:seed\`) and the backend database.`);
    return;
  }
  if (state === null) {
    await (
      await contract("MeridianGovernor", signer(proposerIndex)).getFunction("proposeWithEvidence")(targets, values, calldatas, description, evidence.evidenceRoot, evidence.disclosedWallets, evidence.disclosureUri)
    ).wait();
    say(`proposed by #${proposerIndex} (${await signer(proposerIndex).getAddress()})`);
    await mine(Number(await governor.getFunction("votingDelay")()) + 1);
    state = await stateOf(id);
  }
  if (state === "Pending") {
    await mine(Number(await governor.getFunction("votingDelay")()) + 1);
    state = await stateOf(id);
  }
  if (state === "Active") {
    const votes = (JSON.parse(readFileSync(join(repoRoot, "data", "scenarios", SLUG, "votes.json"), "utf8")) as { votes: { index: number; choice: string }[] }).votes;
    // One block for all votes: 40+ voters as separate blocks would outlast the voting period.
    await provider.send("evm_setAutomine", [false]);
    try {
      const sent: ContractTransactionResponse[] = [];
      for (const v of votes) {
        if ((await governor.getFunction("hasVoted")(id, await signer(v.index).getAddress())) as boolean) continue;
        sent.push(await contract("MeridianGovernor", signer(v.index)).getFunction("castVote")(id, SUPPORT[v.choice.toLowerCase()] ?? 2));
      }
      await provider.send("evm_mine", []);
      await Promise.all(sent.map((tx) => tx.wait()));
    } finally {
      await provider.send("evm_setAutomine", [true]);
    }
    const [against, forVotes] = (await governor.getFunction("proposalVotes")(id)) as [bigint, bigint];
    say(`votes in: ${ethers.formatEther(forVotes)} MRD for, ${ethers.formatEther(against)} against`);
    await mine(Number(await governor.getFunction("votingPeriod")()) + 1);
    state = await stateOf(id);
  }
  if (state !== "Succeeded" && state !== "Queued") {
    say(`proposal is ${state}; expected it to pass. Check votes.json and the quorum.`);
    return;
  }

  // Listen before queueing so the flag event cannot be missed.
  const socket = io(BACKEND, { transports: ["websocket"] });
  socket.emit("subscribe", { proposalId: SLUG });
  const flagged = new Promise<WatchdogFlag>((resolve) => socket.on("watchdog:flag", (f: WatchdogFlag) => resolve(f)));

  let operationId: string;
  const delay = Number(await timelock.getFunction("getMinDelay")());
  let queuedAt = Date.now();
  if (state === "Succeeded") {
    const receipt = await (await contract("MeridianGovernor", signer(proposerIndex)).getFunction("queue")(targets, values, calldatas, descriptionHash)).wait();
    queuedAt = Date.now();
    const ev = receipt!.logs.map((l: ethers.Log) => {
      try {
        return timelock.interface.parseLog(l);
      } catch {
        return null;
      }
    }).find((e: LogDescription | null) => e?.name === "CallScheduled");
    operationId = ev!.args.id as string;
    say(`QUEUED in the GuardedTimelock: operation ${operationId}; executable in ${delay}s unless the watchdog flags it`);
  } else {
    operationId = (await api<ProposalBundle>("GET", `/proposals/${SLUG}`)).body.proposal.operationId!;
    say(`already queued: operation ${operationId}`);
  }

  // Watch: the Socket.IO event, with the on-chain flag as a fallback (e.g. it was flagged before we connected).
  const ticker = setInterval(() => say(`… waiting for the watchdog (${Math.max(0, delay - Math.round((Date.now() - queuedAt) / 1000))}s of delay left)`), 5000);
  // Both fallbacks stop once the race is decided; otherwise they keep the process alive for (delay + 30) s.
  let decided = false;
  let timeout: NodeJS.Timeout | undefined;
  const onchain = (async () => {
    while (!decided) {
      if ((await guard.getFunction("isFlagged")(operationId)) as boolean) return null;
      await sleep(500);
    }
    return undefined;
  })();
  const timedOut = new Promise<undefined>((resolve) => (timeout = setTimeout(() => resolve(undefined), (delay + 30) * 1000)));
  const flag = await Promise.race([flagged, onchain, timedOut]);
  decided = true;
  clearTimeout(timeout);
  clearInterval(ticker);
  socket.close();
  if (flag === undefined) {
    say("no flag within the delay: check the backend logs (watchdog lines) and that the sim is running");
    return;
  }
  const took = ((Date.now() - queuedAt) / 1000).toFixed(1);
  if (flag) {
    say(`FLAGGED ${took}s after queueing (delay ${delay}s): tx ${flag.txHash}, findingsHash ${flag.findingsHash}`);
    say(`risk ${flag.risk.level} (posterior ${flag.risk.posterior}): ${flag.risk.stages.map((s) => `${s.stage} ×${s.likelihoodRatio}`).join(", ")}`);
    for (const f of flag.findings.filter((x) => x.severity === "critical" || x.severity === "high")) say(`  ${f.severity.toUpperCase()} ${f.category}: ${f.does}`);
  } else {
    say(`GovernanceGuard reports the operation flagged (${took}s after queueing)`);
  }

  // Prove it: run the clock past the delay and try to execute.
  await mine(1, delay + 1);
  try {
    await (await contract("MeridianGovernor", signer(proposerIndex)).getFunction("execute")(targets, values, calldatas, descriptionHash)).wait();
    say("UNEXPECTED: the proposal executed");
  } catch (err) {
    const data = (err as { data?: string }).data;
    const parsed = data ? timelock.interface.parseError(data) : null;
    if (parsed?.name === "GuardFlagged") say(`execute() reverted with GuardFlagged(${parsed.args[0]}): MIP-21 is HALTED. Token holders can still override with guard.clear().`);
    else throw err;
  }
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
