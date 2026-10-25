/**
 * Drives a scenario through Meridian governance on the local node.
 *
 *   npm run gov -- propose MIP-21    propose from the scenario's proposer; prints the proposalId and calldata JSON
 *   npm run gov -- vote MIP-21       cast every vote in data/scenarios/<id>/votes.json
 *   npm run gov -- open MIP-17       propose, wait out the voting delay and vote; leaves the proposal Active
 *   npm run gov -- advance [blocks] [seconds]   mine blocks and/or move time forward (default: voting period + 1 block)
 *   npm run gov -- queue MIP-21      queue the passed proposal in the GuardedTimelock; prints the operation id
 *   npm run gov -- execute MIP-21    execute after the timelock delay (reverts GuardFlagged if the watchdog flagged it)
 *   npm run gov -- status MIP-21     on-chain state of the proposal
 *   npm run gov -- override MIP-21   token holders overrule the watchdog: propose guard.clear(operationId), vote,
 *                                    queue and execute it, then execute the original proposal
 *   npm run flow MIP-12              all of the above, resuming from the proposal's current state
 *   npm run gov -- addresses         every deployed address and the demo accounts
 *   npm run gov -- flow MIP-12 + open MIP-17    several commands in one process, in order
 *
 * Standalone ethers script (not `hardhat run`, which cannot take arguments). Uses the default Hardhat mnemonic and
 * contracts/deployments/localhost.json; RPC_URL overrides the node (default http://127.0.0.1:8545).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import { encodeActions, hardhatAddress, hardhatKey, type Action, type Deployments, type EncodedProposal } from "./lib/actions";
import { governorSalt, overrideProposal } from "./lib/override";

const REPO = join(__dirname, "..", "..");
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const STATES = ["Pending", "Active", "Canceled", "Defeated", "Succeeded", "Queued", "Expired", "Executed"] as const;
const SUPPORT: Record<string, number> = { against: 0, for: 1, abstain: 2 };

// cacheTimeout -1: ethers otherwise answers an identical request (e.g. a pending nonce) from a 250 ms cache.
const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
const deployments: Deployments = JSON.parse(readFileSync(join(REPO, "contracts", "deployments", "localhost.json"), "utf8"));

/** One NonceManager per account for the whole run, so consecutive steps never reuse a nonce. */
const signers = new Map<number, ethers.NonceManager>();
const signer = (index: number): ethers.NonceManager => {
  let s = signers.get(index);
  if (!s) {
    s = new ethers.NonceManager(new ethers.Wallet(hardhatKey(index), provider));
    signers.set(index, s);
  }
  return s;
};
const contract = (name: string, runner: ethers.ContractRunner = provider) => {
  const c = deployments.contracts[name];
  if (!c) throw new Error(`${name} missing from deployments/localhost.json`);
  return new ethers.Contract(c.address, c.abi as ethers.InterfaceAbi, runner);
};

interface Vote {
  index: number;
  choice: string;
}

interface Scenario {
  slug: string;
  proposer: number;
  votes: Vote[];
  description: string;
  descriptionHash: string;
  encoded: EncodedProposal;
  proposalId: bigint;
}

function readJson<T>(path: string): T {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Everything derives deterministically from /data, so propose/queue/execute always agree on the description hash. */
async function loadScenario(slug: string): Promise<Scenario> {
  const dir = join(REPO, "data", "scenarios", slug);
  const actions = readJson<Action[] | { actions: Action[] }>(join(dir, "onchain_actions.json"));
  const disclosure = readJson<{ proposerIndex?: number; proposer?: number }>(join(dir, "disclosure.json"));
  const forum = readJson<{ title?: string }>(join(dir, "forum_thread.json"));
  const proposer = disclosure.proposerIndex ?? disclosure.proposer;
  if (typeof proposer !== "number") throw new Error(`${slug}/disclosure.json has no proposerIndex`);

  const encoded = encodeActions(Array.isArray(actions) ? actions : actions.actions, deployments);
  // The backend links chain proposals to its records by the slug in this description.
  const description = `# ${slug}: ${(forum.title ?? slug).replace(/^\[[^\]]+\]\s*/, "")}`;
  const descriptionHash = ethers.id(description);
  const proposalId = (await contract("MeridianGovernor").getFunction("hashProposal")(encoded.targets, encoded.values, encoded.calldatas, descriptionHash)) as bigint;
  const votes = readJson<{ votes: Vote[] }>(join(dir, "votes.json")).votes;
  return { slug, proposer, votes, description, descriptionHash, encoded, proposalId };
}

async function stateOf(s: Scenario): Promise<(typeof STATES)[number] | null> {
  try {
    return STATES[Number(await contract("MeridianGovernor").getFunction("state")(s.proposalId))] ?? null;
  } catch {
    return null; // GovernorNonexistentProposal
  }
}

async function propose(s: Scenario): Promise<void> {
  const governor = contract("MeridianGovernor", signer(s.proposer));
  const receipt = await (await governor.getFunction("propose")(s.encoded.targets, s.encoded.values, s.encoded.calldatas, s.description)).wait();
  console.log(`proposed ${s.slug} from #${s.proposer} (${hardhatAddress(s.proposer)}) in block ${receipt?.blockNumber}`);
  console.log(
    JSON.stringify(
      {
        proposalId: s.slug,
        governorProposalId: s.proposalId.toString(),
        description: s.description,
        descriptionHash: s.descriptionHash,
        targets: s.encoded.targets,
        values: s.encoded.values.map(String),
        calldatas: s.encoded.calldatas,
      },
      null,
      2,
    ),
  );
}

async function vote(s: Scenario): Promise<void> {
  const governor = contract("MeridianGovernor");
  const tally: Record<string, number> = { for: 0, against: 0, abstain: 0 };
  // With automine every vote would be its own block, and 40+ voters outlast a 20-block voting period.
  // Send them all, then mine them into a single block.
  await provider.send("evm_setAutomine", [false]);
  try {
    const sent: ethers.ContractTransactionResponse[] = [];
    for (const v of s.votes) {
      const support = SUPPORT[v.choice.toLowerCase()];
      if (support === undefined) throw new Error(`unknown vote choice ${v.choice} for #${v.index}`);
      if ((await governor.getFunction("hasVoted")(s.proposalId, hardhatAddress(v.index))) as boolean) continue;
      sent.push((await contract("MeridianGovernor", signer(v.index)).getFunction("castVote")(s.proposalId, support)) as ethers.ContractTransactionResponse);
      tally[v.choice.toLowerCase()]!++;
    }
    await provider.send("evm_mine", []);
    await Promise.all(sent.map((tx) => tx.wait()));
  } finally {
    await provider.send("evm_setAutomine", [true]);
  }
  const [against, forVotes, abstain] = (await governor.getFunction("proposalVotes")(s.proposalId)) as [bigint, bigint, bigint];
  console.log(`cast ${tally.for} for / ${tally.against} against / ${tally.abstain} abstain; on-chain weight: for ${ethers.formatEther(forVotes)} MRD, against ${ethers.formatEther(against)}, abstain ${ethers.formatEther(abstain)}`);
}

async function advance(blocks: number, seconds: number): Promise<void> {
  if (seconds > 0) await provider.send("evm_increaseTime", [seconds]);
  if (blocks > 0) await provider.send("hardhat_mine", [ethers.toQuantity(blocks)]);
  else if (seconds > 0) await provider.send("evm_mine", []);
  console.log(`advanced ${blocks} block(s) and ${seconds}s; now at block ${Number(await provider.send("eth_blockNumber", []))}`);
}

async function queue(s: Scenario): Promise<void> {
  const governor = contract("MeridianGovernor", signer(s.proposer));
  const receipt = await (await governor.getFunction("queue")(s.encoded.targets, s.encoded.values, s.encoded.calldatas, s.descriptionHash)).wait();
  const timelock = contract("GuardedTimelock");
  const scheduled = receipt!.logs.map((l: ethers.Log) => {
    try {
      return timelock.interface.parseLog(l);
    } catch {
      return null;
    }
  }).find((e: ethers.LogDescription | null) => e?.name === "CallScheduled");
  const eta = (await governor.getFunction("proposalEta")(s.proposalId)) as bigint;
  console.log(`queued ${s.slug}: operationId ${scheduled?.args.id}, executable after ${new Date(Number(eta) * 1000).toISOString()}`);
}

async function execute(s: Scenario): Promise<boolean> {
  const governor = contract("MeridianGovernor", signer(s.proposer));
  try {
    const receipt = await (await governor.getFunction("execute")(s.encoded.targets, s.encoded.values, s.encoded.calldatas, s.descriptionHash)).wait();
    console.log(`executed ${s.slug} in block ${receipt?.blockNumber}`);
    return true;
  } catch (err) {
    const data = (err as { data?: string }).data;
    const timelock = contract("GuardedTimelock");
    const parsed = data ? timelock.interface.parseError(data) : null;
    if (parsed?.name === "GuardFlagged") {
      console.log(`HALTED: ${s.slug} cannot execute; GovernanceGuard flagged operation ${parsed.args[0]}. Token holders can override with guard.clear().`);
      return false;
    }
    throw err;
  }
}

/** The timelock operation id a queued proposal gets (what the watchdog flags). */
async function operationIdOf(s: Scenario): Promise<string> {
  const salt = governorSalt(await contract("MeridianGovernor").getAddress(), s.descriptionHash);
  return (await contract("GuardedTimelock").getFunction("hashOperationBatch")(s.encoded.targets, s.encoded.values, s.encoded.calldatas, ethers.ZeroHash, salt)) as string;
}

/**
 * Token holders overrule the watchdog: a proposal calling guard.clear(operationId) goes through the full
 * propose -> vote -> queue -> delay -> execute cycle, and then the original proposal executes after all.
 * Everyone in the scenario's votes.json votes For the override (edit here to stage a contested override).
 */
async function override(s: Scenario): Promise<void> {
  const operationId = await operationIdOf(s);
  const guard = contract("GovernanceGuard");
  if (!((await guard.getFunction("isFlagged")(operationId)) as boolean)) {
    throw new Error(`${s.slug} (operation ${operationId}) is not flagged; nothing to override`);
  }
  const o = overrideProposal(await guard.getAddress(), operationId, s.slug);
  const descriptionHash = ethers.id(o.description);
  const encoded: EncodedProposal = { targets: o.targets, values: o.values, calldatas: o.calldatas };
  const proposalId = (await contract("MeridianGovernor").getFunction("hashProposal")(o.targets, o.values, o.calldatas, descriptionHash)) as bigint;
  const overrideScenario: Scenario = {
    slug: `${s.slug} override`,
    proposer: 2, // any token holder may propose (threshold 0); #2 is a delegate
    votes: s.votes.map((v) => ({ index: v.index, choice: "for" })),
    description: o.description,
    descriptionHash,
    encoded,
    proposalId,
  };
  console.log(`overriding the watchdog flag on ${s.slug} (operation ${operationId})`);
  await flow(overrideScenario);
  if ((await guard.getFunction("isFlagged")(operationId)) as boolean) throw new Error("override executed but the operation is still flagged");
  console.log(`\n== flag cleared by governance; executing ${s.slug}`);
  await execute(s);
}

async function status(s: Scenario): Promise<void> {
  const state = await stateOf(s);
  console.log(`${s.slug}: ${state ?? "not proposed"} (governorProposalId ${s.proposalId})`);
}

/** Runs whatever steps remain for the proposal's current on-chain state. */
async function flow(s: Scenario): Promise<void> {
  const governor = contract("MeridianGovernor");
  const votingDelay = Number(await governor.getFunction("votingDelay")());
  const votingPeriod = Number(await governor.getFunction("votingPeriod")());
  const minDelay = Number(await contract("GuardedTimelock").getFunction("getMinDelay")());

  for (;;) {
    const state = await stateOf(s);
    console.log(`\n== ${s.slug}: ${state ?? "not proposed"}`);
    if (state === null) await propose(s);
    else if (state === "Pending") await advance(votingDelay + 1, 0);
    else if (state === "Active") {
      await vote(s);
      await advance(votingPeriod + 1, 0);
    } else if (state === "Succeeded") {
      await queue(s);
      await advance(1, minDelay + 1);
    } else if (state === "Queued") {
      if (!(await execute(s))) return;
    } else {
      console.log(state === "Executed" ? "done." : `stopped: proposal is ${state}.`);
      return;
    }
  }
}

/** Proposes and votes, then stops with the proposal still Active (the voting period keeps running). */
async function open(s: Scenario): Promise<void> {
  if ((await stateOf(s)) === null) await propose(s);
  if ((await stateOf(s)) === "Pending") await advance(Number(await contract("MeridianGovernor").getFunction("votingDelay")()) + 1, 0);
  if ((await stateOf(s)) !== "Active") throw new Error(`${s.slug} is ${await stateOf(s)}, cannot vote`);
  await vote(s);
  await status(s);
}

/** Every contract address plus the accounts the demo talks about. */
function addresses(): void {
  for (const [name, c] of Object.entries(deployments.contracts)) console.log(`  ${name.padEnd(26)} ${c.address}`);
  const accounts: [string, number][] = [["deployer / committer", 0], ["watchdog", 1], ["MIP-21 proposer", 13], ["MIP-21 alt wallet", 14]];
  for (const [label, i] of accounts) console.log(`  ${`${label} #${i}`.padEnd(26)} ${hardhatAddress(i)}`);
}

const USAGE = "usage: governance.ts <propose|vote|open|queue|execute|status|flow|override> <MIP-xx> | advance [blocks] [seconds] | addresses  (chain several with +)";

async function runOne(command: string | undefined, arg1: string | undefined, arg2: string | undefined): Promise<void> {
  if (command === "addresses") return addresses();
  if (command === "advance") {
    const votingPeriod = Number(await contract("MeridianGovernor").getFunction("votingPeriod")());
    return advance(arg1 !== undefined ? Number(arg1) : votingPeriod + 1, arg2 !== undefined ? Number(arg2) : 0);
  }
  if (!command || !arg1) throw new Error(USAGE);
  const s = await loadScenario(arg1);
  const commands: Record<string, (x: Scenario) => Promise<unknown>> = { propose, vote, open, queue, execute, status, flow, override };
  const run = commands[command];
  if (!run) throw new Error(`unknown command ${command}`);
  await run(s);
}

/** `flow MIP-12 + open MIP-17 + status MIP-21` runs the commands in order in one process (reset.sh uses this). */
async function main(): Promise<void> {
  const groups: string[][] = [[]];
  for (const a of process.argv.slice(2)) {
    if (a === "+") groups.push([]);
    else groups.at(-1)!.push(a);
  }
  for (const [command, arg1, arg2] of groups) await runOne(command, arg1, arg2);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message.split("\n")[0] : err);
  process.exitCode = 1;
});
