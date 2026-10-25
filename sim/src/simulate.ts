import canonicalize from "canonicalize";
import { getAddress, id as topicOf, Interface, isError, keccak256, toQuantity, toUtf8Bytes, zeroPadValue, ZeroHash, type JsonRpcProvider } from "ethers";
import type { Logger } from "pino";
import { decodeCall, decodeLog, decodeRevert, type ProxyAbis } from "./decode.js";
import type { ContractBook } from "./deployments.js";
import { SimulationResult, type DecodedCallT, type SimulateRequestT, type SimulationResultT } from "./schema.js";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967 implementation
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"; // EIP-1967 admin
const TRANSFER = topicOf("Transfer(address,address,uint256)");
const APPROVAL = topicOf("Approval(address,address,uint256)");
const OWNER = new Interface(["function owner() view returns (address)"]);
const ERC20 = new Interface(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const ZERO32 = `0x${"0".repeat(64)}`;

export interface SimulatorDeps {
  anvil: JsonRpcProvider;
  /** The Hardhat node the fork is taken from. */
  source: JsonRpcProvider;
  rpcUrl: string;
  book: ContractBook;
  logger: Pick<Logger, "info" | "warn">;
}

interface Snapshot {
  owner: Map<string, string>;
  impl: Map<string, string>;
  admin: Map<string, string>;
  balances: Map<string, bigint>; // `${token}|${holder}`
}

/** Log fields as returned by eth_getTransactionReceipt. */
interface RawLog {
  address: string;
  topics: string[];
  data: string;
}
interface RawReceipt {
  status: string;
  logs: RawLog[];
}

type PrestateDiff = { pre?: Record<string, { storage?: Record<string, string> }>; post?: Record<string, { storage?: Record<string, string> }> };

const slotToAddress = (v: string): string => getAddress(`0x${v.slice(-40)}`);
const pad32 = (v: string): string => zeroPadValue(v, 32).toLowerCase();

/**
 * Simulates a proposal as the timelock would execute it (one all-or-nothing batch) on a fresh fork and reports
 * facts only. Simulations are serialized because they share one Anvil instance.
 */
export class Simulator {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: SimulatorDeps) {}

  simulate(req: SimulateRequestT): Promise<SimulationResultT> {
    const run = this.queue.then(() => this.run(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(req: SimulateRequestT): Promise<SimulationResultT> {
    const { anvil, book } = this.d;
    const forkBlock = req.forkBlock ?? Number(await this.d.source.send("eth_blockNumber", []));
    // Re-fork every time so the simulation sees the chain as it is now (or at forkBlock), never a stale fork.
    await anvil.send("anvil_reset", [{ forking: { jsonRpcUrl: this.d.rpcUrl, blockNumber: forkBlock } }]);
    const snapshot = (await anvil.send("evm_snapshot", [])) as string;

    const timelock = book.get("GuardedTimelock").address;
    const tokens = ["MockUSDC", "MeridianToken"].map((n) => book.get(n).address);
    const holders = ["Treasury", "VaultProxy", "GuardedTimelock"].map((n) => book.get(n).address);

    // Every address the calldata mentions is a potential spender/recipient worth watching.
    const decodedCalls: DecodedCallT[] = [];
    const proxies: ProxyAbis = new Map();
    let success = true;
    const facts: SimulationResultT["events"] = [];
    let revertReason: string | undefined;
    const logs: RawLog[] = [];
    const storage = new Map<string, { before: string; after: string }>(); // `${contract}|${slot}`
    let before: Snapshot;
    let after: Snapshot;
    let watched: { owner: string; spender: string }[] = [];
    let allowanceAfter = new Map<string, bigint>();

    try {
      await anvil.send("anvil_impersonateAccount", [timelock]);
      await anvil.send("anvil_setBalance", [timelock, toQuantity(10n ** 21n)]);
      before = await this.observe(holders, tokens);
      this.registerProxies(proxies, before);

      for (let i = 0; i < req.targets.length; i++) {
        const tx = { from: timelock, to: req.targets[i]!, data: req.calldatas[i]!, value: toQuantity(BigInt(req.values[i]!)) };
        decodedCalls.push(...decodeCall(book, proxies, tx.to, tx.data, BigInt(req.values[i]!)));
        // A call to an address without code succeeds and does nothing: a fact worth surfacing, not a revert.
        if ((await anvil.getCode(tx.to)) === "0x") facts.push({ contract: getAddress(tx.to), name: "NoCodeAtTarget", args: { callIndex: i } });
        try {
          await anvil.call(tx);
        } catch (err) {
          success = false;
          revertReason = `call ${i}: ${decodeRevert(book, isError(err, "CALL_EXCEPTION") ? err.data : (err as { data?: string }).data)}`;
          break;
        }
        const diff = (await anvil.send("debug_traceCall", [tx, "latest", { tracer: "prestateTracer", tracerConfig: { diffMode: true } }])) as PrestateDiff;
        this.accumulate(storage, diff);
        const hash = (await anvil.send("eth_sendTransaction", [tx])) as string;
        const receipt = await this.receipt(hash);
        if (receipt.status !== "0x1") {
          success = false;
          revertReason = `call ${i}: reverted on execution`;
          break;
        }
        logs.push(...receipt.logs);
        // An upgrade inside this call changes how later calls through the proxy decode.
        this.registerProxies(proxies, await this.observe(holders, tokens));
      }

      after = await this.observe(holders, tokens);
      const mentioned = decodedCalls.flatMap((c) => c.args.flat(3)).filter((a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a));
      const spenders = [...new Set([...mentioned, ...book.all().map((c) => c.address), timelock].map((a) => a.toLowerCase()))];
      watched = holders.flatMap((owner) => spenders.map((spender) => ({ owner, spender })));
      allowanceAfter = await this.allowances(tokens, watched);
    } finally {
      await anvil.send("evm_revert", [snapshot]);
      await anvil.send("anvil_stopImpersonatingAccount", [timelock]).catch(() => undefined);
    }
    // Back at the pre-state: the "before" side of every watched allowance.
    const allowanceBefore = await this.allowances(tokens, watched);

    const result = this.assemble({ req, success, facts, ...(revertReason ? { revertReason } : {}), decodedCalls, logs: success ? logs : [], storage: success ? storage : new Map(), before: before!, after: success ? after! : before!, allowanceBefore, allowanceAfter: success ? allowanceAfter : allowanceBefore, proxies, tokens });
    const bytecodeHash = await this.bytecodeHash(result.implementationChanges);
    const unsigned = { ...result, bytecodeHash };
    const simHash = keccak256(toUtf8Bytes(canonicalize(unsigned)!));
    return SimulationResult.parse({ ...unsigned, simHash });
  }

  /**
   * Raw receipt polling. ethers' waitForTransaction ignores blocks below the highest it has seen, and every
   * simulation rewinds Anvil (evm_revert / anvil_reset), so it would wait forever on the second run.
   */
  private async receipt(hash: string): Promise<RawReceipt> {
    for (let i = 0; i < 200; i++) {
      const r = (await this.d.anvil.send("eth_getTransactionReceipt", [hash])) as RawReceipt | null;
      if (r) return r;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`no receipt for ${hash} after 5 s`);
  }

  /** owner(), EIP-1967 slots and token balances of the watched holders. */
  private async observe(holders: string[], tokens: string[]): Promise<Snapshot> {
    const { anvil, book } = this.d;
    const s: Snapshot = { owner: new Map(), impl: new Map(), admin: new Map(), balances: new Map() };
    await Promise.all(
      book.all().map(async (c) => {
        const [impl, admin] = await Promise.all([anvil.getStorage(c.address, IMPL_SLOT), anvil.getStorage(c.address, ADMIN_SLOT)]);
        s.impl.set(c.address, impl);
        s.admin.set(c.address, admin);
        if (c.iface.getFunction("owner")) {
          try {
            const out = await anvil.call({ to: c.address, data: OWNER.encodeFunctionData("owner") });
            s.owner.set(c.address, OWNER.decodeFunctionResult("owner", out)[0] as string);
          } catch {
            // owner() reverted (e.g. an uninitialized implementation): nothing to compare
          }
        }
      }),
    );
    await Promise.all(
      tokens.flatMap((t) =>
        holders.map(async (h) => {
          s.balances.set(`${t}|${h.toLowerCase()}`, await this.readUint(t, ERC20.encodeFunctionData("balanceOf", [h]), "balanceOf"));
        }),
      ),
    );
    return s;
  }

  private async allowances(tokens: string[], pairs: { owner: string; spender: string }[]): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    await Promise.all(
      tokens.flatMap((t) =>
        pairs.map(async ({ owner, spender }) => {
          out.set(`${t}|${owner.toLowerCase()}|${spender}`, await this.readUint(t, ERC20.encodeFunctionData("allowance", [owner, spender]), "allowance"));
        }),
      ),
    );
    return out;
  }

  /** A token view that returns nothing (e.g. not deployed at forkBlock) reads as 0 instead of failing the simulation. */
  private async readUint(to: string, data: string, fn: "balanceOf" | "allowance"): Promise<bigint> {
    const out = await this.d.anvil.call({ to, data });
    return out === "0x" ? 0n : (ERC20.decodeFunctionResult(fn, out)[0] as bigint);
  }

  /** Proxies decode with the ABIs of the implementations they have pointed at. */
  private registerProxies(proxies: ProxyAbis, s: Snapshot): void {
    for (const [proxy, slot] of s.impl) {
      if (slot === ZERO32) continue;
      const impl = this.d.book.at(slotToAddress(slot));
      if (!impl) continue;
      const list = proxies.get(proxy) ?? [];
      if (!list.includes(impl.iface)) list.push(impl.iface);
      proxies.set(proxy, list);
    }
  }

  /** First "before" and last "after" per slot across calls, for known contracts only. */
  private accumulate(storage: Map<string, { before: string; after: string }>, diff: PrestateDiff): void {
    const known = (a: string) => this.d.book.at(a) !== undefined;
    const touched = new Set([...Object.keys(diff.pre ?? {}), ...Object.keys(diff.post ?? {})].map((a) => a.toLowerCase()).filter(known));
    for (const addr of touched) {
      const pre = Object.entries(diff.pre ?? {}).find(([a]) => a.toLowerCase() === addr)?.[1]?.storage ?? {};
      const post = Object.entries(diff.post ?? {}).find(([a]) => a.toLowerCase() === addr)?.[1]?.storage ?? {};
      for (const slot of new Set([...Object.keys(pre), ...Object.keys(post)])) {
        const key = `${addr}|${pad32(slot)}`;
        const b = pad32(pre[slot] ?? ZERO32);
        const a = pad32(post[slot] ?? ZERO32); // in diffMode a slot cleared to zero is missing from post
        const prev = storage.get(key);
        storage.set(key, { before: prev?.before ?? b, after: a });
      }
    }
  }

  private assemble(x: {
    req: SimulateRequestT;
    success: boolean;
    revertReason?: string;
    decodedCalls: DecodedCallT[];
    logs: RawLog[];
    storage: Map<string, { before: string; after: string }>;
    before: Snapshot;
    after: Snapshot;
    allowanceBefore: Map<string, bigint>;
    allowanceAfter: Map<string, bigint>;
    proxies: ProxyAbis;
    tokens: string[];
    facts: SimulationResultT["events"];
  }): Omit<SimulationResultT, "bytecodeHash" | "simHash"> {
    const { book } = this.d;
    const events = [...x.facts, ...x.logs.map((l) => decodeLog(book, x.proxies, l))];
    const addr = (t: string | undefined) => getAddress(`0x${(t ?? "").slice(-40)}`);
    const tokenTransfers = x.logs.filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3).map((l) => ({ token: getAddress(l.address), from: addr(l.topics[1]), to: addr(l.topics[2]), amount: BigInt(l.data).toString() }));
    const approvals = x.logs.filter((l) => l.topics[0] === APPROVAL && l.topics.length === 3).map((l) => ({ token: getAddress(l.address), owner: addr(l.topics[1]), spender: addr(l.topics[2]), amount: BigInt(l.data).toString() }));

    // State is the ground truth; events can be omitted. Report changes the logs do not explain.
    for (const [key, after] of x.allowanceAfter) {
      const beforeAmt = x.allowanceBefore.get(key) ?? 0n;
      if (after === beforeAmt) continue;
      const [token, owner, spender] = key.split("|") as [string, string, string];
      if (approvals.some((a) => a.token.toLowerCase() === token.toLowerCase() && a.owner.toLowerCase() === owner && a.spender.toLowerCase() === spender)) continue;
      approvals.push({ token: getAddress(token), owner: getAddress(owner), spender: getAddress(spender), amount: after.toString() });
      events.push({ contract: getAddress(token), name: "UnloggedAllowanceChange", args: { owner: getAddress(owner), spender: getAddress(spender), before: beforeAmt.toString(), after: after.toString() } });
    }
    for (const [key, afterBal] of x.after.balances) {
      const beforeBal = x.before.balances.get(key) ?? 0n;
      const [token, holder] = key.split("|") as [string, string];
      const logged = tokenTransfers.filter((t) => t.token.toLowerCase() === token.toLowerCase()).reduce((s, t) => s + (t.to.toLowerCase() === holder ? BigInt(t.amount) : 0n) - (t.from.toLowerCase() === holder ? BigInt(t.amount) : 0n), 0n);
      if (afterBal - beforeBal !== logged) {
        events.push({ contract: getAddress(token), name: "UnloggedBalanceChange", args: { account: getAddress(holder), before: beforeBal.toString(), after: afterBal.toString(), loggedDelta: logged.toString() } });
      }
    }

    const ownershipChanges: SimulationResultT["ownershipChanges"] = [];
    for (const [c, ownerAfter] of x.after.owner) {
      const ownerBefore = x.before.owner.get(c);
      if (ownerBefore && ownerBefore.toLowerCase() !== ownerAfter.toLowerCase()) ownershipChanges.push({ contract: getAddress(c), role: "owner", before: ownerBefore, after: ownerAfter });
    }
    for (const [c, adminAfter] of x.after.admin) {
      const adminBefore = x.before.admin.get(c) ?? ZERO32;
      if (adminBefore !== adminAfter) ownershipChanges.push({ contract: getAddress(c), role: "proxyAdmin", before: slotToAddress(adminBefore), after: slotToAddress(adminAfter) });
    }

    const implementationChanges: SimulationResultT["implementationChanges"] = [];
    for (const [proxy, implAfter] of x.after.impl) {
      const implBefore = x.before.impl.get(proxy) ?? ZERO32;
      if (implBefore === implAfter) continue;
      const oldI = book.at(slotToAddress(implBefore))?.iface;
      const newI = book.at(slotToAddress(implAfter))?.iface;
      const selectors = (i?: Interface) => new Map((i?.fragments ?? []).flatMap((f) => (f.type === "function" ? [[(f as unknown as { selector: string }).selector, (f as unknown as { format: (s: string) => string }).format("sighash")] as const] : [])));
      const o = selectors(oldI);
      const n = selectors(newI);
      implementationChanges.push({
        proxy: getAddress(proxy),
        before: slotToAddress(implBefore),
        after: slotToAddress(implAfter),
        // From known ABIs; unknown implementations get bytecode-level selectors in a later step (evmole).
        addedSelectors: newI ? [...n].filter(([s]) => !o.has(s)).map(([selector, signature]) => ({ selector, signature })) : [],
        removedSelectors: newI && oldI ? [...o].filter(([s]) => !n.has(s)).map(([selector, signature]) => ({ selector, signature })) : [],
      });
    }

    const storageDiffs = [...x.storage]
      .filter(([, v]) => v.before !== v.after)
      .map(([key, v]) => {
        const [contract, slot] = key.split("|") as [string, string];
        return { contract: getAddress(contract), slot, before: v.before, after: v.after };
      });

    return {
      proposalId: x.req.proposalId,
      success: x.success,
      ...(x.revertReason ? { revertReason: x.revertReason } : {}),
      decodedCalls: x.decodedCalls,
      tokenTransfers,
      approvals,
      ownershipChanges,
      implementationChanges,
      storageDiffs,
      events,
    };
  }

  /** keccak256 of the new implementation's runtime code (first upgrade), else ZeroHash (no new code). */
  private async bytecodeHash(changes: SimulationResultT["implementationChanges"]): Promise<string> {
    const first = changes[0];
    if (!first) return ZeroHash;
    const code = await this.d.anvil.getCode(first.after);
    return code === "0x" ? ZeroHash : keccak256(code);
  }
}
