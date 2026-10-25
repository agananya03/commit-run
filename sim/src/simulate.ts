import canonicalize from "canonicalize";
import { getAddress, id as topicOf, Interface, isError, keccak256, toQuantity, toUtf8Bytes, zeroPadValue, ZeroAddress, ZeroHash, type JsonRpcProvider } from "ethers";
import type { Logger } from "pino";
import { extractSelectors, scanOpcodes, SignatureResolver } from "./bytecode.js";
import { decodeCall, decodeLog, decodeRevert, type ProxyAbis } from "./decode.js";
import type { ContractBook } from "./deployments.js";
import { SimulationResult, type DecodedCallT, type SimulateRequestT, type SimulationResultT } from "./schema.js";

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // EIP-1967 implementation
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"; // EIP-1967 admin
const TRANSFER = topicOf("Transfer(address,address,uint256)");
const APPROVAL = topicOf("Approval(address,address,uint256)");
const OWNER = new Interface(["function owner() view returns (address)"]);
const ROLES = new Interface(["function hasRole(bytes32,address) view returns (bool)"]);
const ERC20 = new Interface(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);
const ZERO32 = `0x${"0".repeat(64)}`;
/** Reads in flight against the fork: Anvil fetches cold state from the Hardhat node, which stalls under bursts. */
const READ_CONCURRENCY = 8;

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
/** callTracer frame (geth format, as Anvil returns it). */
interface CallFrame {
  type: string;
  from: string;
  to?: string;
  value?: string;
  error?: string;
  calls?: CallFrame[];
}

type TransferT = SimulationResultT["tokenTransfers"][number];

const slotToAddress = (v: string): string => getAddress(`0x${v.slice(-40)}`);
const pad32 = (v: string): string => zeroPadValue(v, 32).toLowerCase();
const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => key(a).localeCompare(key(b));
const sortedEntries = <V>(m: Map<string, V>): [string, V][] => [...m].sort(([a], [b]) => a.localeCompare(b));

/** Value moved by successful CALL/CREATE/SELFDESTRUCT frames, depth-first in execution order. Reverted subtrees moved nothing. */
export function ethTransfersOf(frame: CallFrame): TransferT[] {
  if (frame.error) return [];
  const value = BigInt(frame.value ?? "0x0");
  // DELEGATECALL/STATICCALL frames echo the parent's value or carry none; they never move ETH themselves.
  const moves = value > 0n && frame.to && !["DELEGATECALL", "STATICCALL", "CALLCODE"].includes(frame.type.toUpperCase());
  const own: TransferT[] = moves ? [{ token: "ETH", from: getAddress(frame.from), to: getAddress(frame.to!), amount: value.toString() }] : [];
  return [...own, ...(frame.calls ?? []).flatMap(ethTransfersOf)];
}

/**
 * Simulates a proposal as the timelock would execute it (one all-or-nothing batch) on a fresh fork and reports
 * facts only. Simulations are serialized because they share one Anvil instance. Deterministic for a pinned
 * forkBlock: block timestamps are fixed relative to the fork block and every map-derived list is sorted.
 */
export class Simulator {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly resolver: SignatureResolver;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly d: SimulatorDeps) {
    this.resolver = new SignatureResolver(d.book);
  }

  simulate(req: SimulateRequestT): Promise<SimulationResultT> {
    return this.enqueue(() => this.run(req));
  }

  /** The deployments the simulator decodes with (served as GET /deployments). */
  get deployments() {
    return this.d.book.deployments;
  }

  /**
   * Re-forks Anvil from the source node's current head (or forkBlock), dropping any state left on the fork. Queued
   * behind running simulations, so it never pulls the fork out from under one.
   */
  reset(forkBlock?: number): Promise<{ forkBlock: number; sourceHead: number }> {
    return this.enqueue(async () => {
      const sourceHead = Number(await this.d.source.send("eth_blockNumber", []));
      const block = forkBlock ?? sourceHead;
      await this.d.anvil.send("anvil_reset", [{ forking: { jsonRpcUrl: this.d.rpcUrl, blockNumber: block } }]);
      this.d.logger.info({ forkBlock: block, sourceHead }, "fork reset");
      return { forkBlock: block, sourceHead };
    });
  }

  private enqueue<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(req: SimulateRequestT): Promise<SimulationResultT> {
    const { anvil, book } = this.d;
    const forkBlock = req.forkBlock ?? Number(await this.d.source.send("eth_blockNumber", []));
    // Re-fork every time so the simulation sees the chain as it is now (or at forkBlock), never a stale fork.
    await anvil.send("anvil_reset", [{ forking: { jsonRpcUrl: this.d.rpcUrl, blockNumber: forkBlock } }]);
    const snapshot = (await anvil.send("evm_snapshot", [])) as string;
    const forkTimestamp = Number(((await anvil.send("eth_getBlockByNumber", [toQuantity(forkBlock), false])) as { timestamp: string }).timestamp);

    const timelock = book.get("GuardedTimelock").address;
    const tokens = ["MockUSDC", "MeridianToken"].map((n) => book.get(n).address);
    const holders = ["Treasury", "VaultProxy", "GuardedTimelock"].map((n) => book.get(n).address);

    const decodedCalls: DecodedCallT[] = [];
    const proxies: ProxyAbis = new Map();
    let success = true;
    const facts: SimulationResultT["events"] = [];
    let revertReason: string | undefined;
    const perCall: { eth: TransferT[]; logs: RawLog[] }[] = [];
    const storage = new Map<string, { before: string; after: string }>(); // `${contract}|${slot}`
    let before: Snapshot;
    let after: Snapshot;
    let watched: { owner: string; spender: string }[] = [];
    let allowanceAfter = new Map<string, bigint>();
    let probed: { contracts: string[]; accounts: string[] } = { contracts: [], accounts: [] };
    let rolesAfter = new Map<string, boolean>();
    let allowanceTokens: string[] = [];
    const codes = new Map<string, string>(); // implementation address -> runtime code, read before the fork rewinds

    try {
      await anvil.send("anvil_impersonateAccount", [timelock]);
      before = await this.observe(holders, tokens, req.targets);
      this.registerProxies(proxies, before.impl);

      for (let i = 0; i < req.targets.length; i++) {
        const value = BigInt(req.values[i]!);
        const tx = { from: timelock, to: req.targets[i]!, data: req.calldatas[i]!, value: toQuantity(value) };
        decodedCalls.push(...decodeCall(book, proxies, tx.to, tx.data, value));
        // A call to an address without code succeeds and does nothing: a fact worth surfacing, not a revert.
        if ((await anvil.getCode(tx.to)) === "0x") facts.push({ contract: getAddress(tx.to), name: "NoCodeAtTarget", args: { callIndex: i } });
        try {
          await anvil.call(tx);
        } catch (err) {
          success = false;
          revertReason = `call ${i}: ${decodeRevert(book, isError(err, "CALL_EXCEPTION") ? err.data : (err as { data?: string }).data)}`;
          // The batch stops here, but the remaining calls are still part of what was proposed.
          for (let j = i + 1; j < req.targets.length; j++) decodedCalls.push(...decodeCall(book, proxies, req.targets[j]!, req.calldatas[j]!, BigInt(req.values[j]!)));
          break;
        }
        // Fixed timestamps and zero gas price: the timelock pays no gas, so its real ETH balance is what the calls can spend.
        await anvil.send("evm_setNextBlockTimestamp", [toQuantity(forkTimestamp + i + 1)]);
        await anvil.send("anvil_setNextBlockBaseFeePerGas", ["0x0"]);
        const hash = (await anvil.send("eth_sendTransaction", [{ ...tx, gasPrice: "0x0" }])) as string;
        const receipt = await this.receipt(hash);
        if (receipt.status !== "0x1") {
          success = false;
          revertReason = `call ${i}: reverted on execution`;
          break;
        }
        // Traces of the mined transaction (not a re-run at "latest"), so they match exactly what executed.
        const [diff, calls] = await Promise.all([
          anvil.send("debug_traceTransaction", [hash, { tracer: "prestateTracer", tracerConfig: { diffMode: true } }]) as Promise<PrestateDiff>,
          anvil.send("debug_traceTransaction", [hash, { tracer: "callTracer" }]) as Promise<CallFrame>,
        ]);
        this.accumulate(storage, diff);
        perCall.push({ eth: ethTransfersOf(calls), logs: receipt.logs });
        // An upgrade inside this call changes how later calls through the proxy decode.
        this.registerProxies(proxies, await this.implSlots());
      }

      after = await this.observe(holders, tokens, req.targets);
      for (const [proxy, slot] of after.impl) {
        const prev = before.impl.get(proxy) ?? ZERO32;
        if (prev === slot) continue;
        for (const s of [prev, slot]) if (s !== ZERO32) codes.set(slotToAddress(s).toLowerCase(), await anvil.getCode(slotToAddress(s)));
      }
      // Only contracts whose storage changed can have changed allowances or roles: probe just those.
      const touched = new Set([...storage.keys()].map((k) => k.split("|")[0]!));
      const accounts = this.candidates(decodedCalls, timelock);
      watched = holders.flatMap((owner) => accounts.map((spender) => ({ owner, spender })));
      probed = { contracts: book.all().filter((c) => touched.has(c.address) && c.iface.getFunction("hasRole")).map((c) => c.address).sort(), accounts };
      allowanceTokens = tokens.filter((t) => touched.has(t.toLowerCase()));
      allowanceAfter = await this.allowances(allowanceTokens, watched);
      rolesAfter = await this.roles(probed.contracts, probed.accounts);
    } finally {
      await anvil.send("evm_revert", [snapshot]);
      await anvil.send("anvil_stopImpersonatingAccount", [timelock]).catch(() => undefined);
    }
    // Back at the pre-state: the "before" side of every watched allowance and role.
    const allowanceBefore = await this.allowances(allowanceTokens, watched);
    const rolesBefore = await this.roles(probed.contracts, probed.accounts);

    const result = this.assemble({
      req,
      success,
      facts,
      ...(revertReason ? { revertReason } : {}),
      decodedCalls,
      perCall: success ? perCall : [],
      storage: success ? storage : new Map(),
      before: before!,
      after: success ? after! : before!,
      allowanceBefore,
      allowanceAfter: success ? allowanceAfter : allowanceBefore,
      rolesBefore,
      rolesAfter: success ? rolesAfter : rolesBefore,
      proxies,
      codes,
    });
    const first = result.implementationChanges[0];
    const newCode = first ? codes.get(first.after.toLowerCase()) : undefined;
    const bytecodeHash = newCode && newCode !== "0x" ? keccak256(newCode) : ZeroHash;
    const unsigned = { ...result, bytecodeHash };
    const simHash = keccak256(toUtf8Bytes(canonicalize(unsigned)!));
    return SimulationResult.parse({ ...unsigned, simHash });
  }

  /** Accounts worth probing for allowances and roles: calldata addresses, known contracts, the timelock. Sorted. */
  private candidates(calls: DecodedCallT[], timelock: string): string[] {
    const mentioned = calls.flatMap((c) => c.args.flat(3)).filter((a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a));
    return [...new Set([...mentioned, ...this.d.book.all().map((c) => c.address), timelock].map((a) => a.toLowerCase()))].sort();
  }

  /**
   * State reads go through here: at most READ_CONCURRENCY at once, and a failure without revert data (the fork
   * could not fetch state from the source node) is retried, so a hiccup never reads as "no owner" or "0 allowance".
   */
  private async read<T>(f: () => Promise<T>, retry = true): Promise<T> {
    while (this.active >= READ_CONCURRENCY) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await f();
        } catch (err) {
          const transient = isError(err, "CALL_EXCEPTION") ? !err.data || err.data === "0x" : true;
          if (!retry || !transient || attempt >= 2) throw err;
          await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  /** retry = false where an empty revert is an expected answer (probing a function the contract may not have). */
  private ethCall(tx: { to: string; data: string }, retry = true): Promise<string> {
    return this.read(() => this.d.anvil.call(tx), retry);
  }

  private storageAt(address: string, slot: string): Promise<string> {
    return this.read(() => this.d.anvil.getStorage(address, slot));
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

  /** owner() of every known contract and call target (whatever its ABI says), EIP-1967 slots, token balances. */
  private async observe(holders: string[], tokens: string[], targets: string[]): Promise<Snapshot> {
    const { book } = this.d;
    const s: Snapshot = { owner: new Map(), impl: new Map(), admin: new Map(), balances: new Map() };
    const contracts = [...new Set([...book.all().map((c) => c.address), ...targets.map((t) => t.toLowerCase())])];
    await Promise.all(
      contracts.map(async (address) => {
        const [impl, admin] = await Promise.all([this.storageAt(address, IMPL_SLOT), this.storageAt(address, ADMIN_SLOT)]);
        // Retry owner() only where it must exist: the ABI declares it, or a proxy forwards to an implementation.
        const owner = await this.ownerOf(address, Boolean(book.at(address)?.iface.getFunction("owner")) || impl !== ZERO32);
        s.impl.set(address, impl);
        s.admin.set(address, admin);
        if (owner) s.owner.set(address, owner);
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

  /** Just the EIP-1967 implementation slots of known contracts (between calls, for decoding). */
  private async implSlots(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await Promise.all(this.d.book.all().map(async (c) => out.set(c.address, await this.storageAt(c.address, IMPL_SLOT))));
    return out;
  }

  /** Post-execution privilege probe: hasRole(role, account) for DEFAULT_ADMIN_ROLE and every *_ROLE constant. */
  private async roles(contracts: string[], accounts: string[]): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    await Promise.all(
      contracts.map(async (address) => {
        const roles = await this.roleIds(address, this.d.book.at(address)!.iface);
        await Promise.all(
          roles.flatMap(([name, role]) =>
            accounts.map(async (account) => {
              try {
                const res = await this.ethCall({ to: address, data: ROLES.encodeFunctionData("hasRole", [role, account]) });
                out.set(`${address}|${name}|${account}`, ROLES.decodeFunctionResult("hasRole", res)[0] as boolean);
              } catch {
                // hasRole reverted: unknown, not a change
              }
            }),
          ),
        );
      }),
    );
    return out;
  }

  /** owner() if the contract answers with exactly one ABI-encoded address, else null. */
  private async ownerOf(address: string, expected: boolean): Promise<string | null> {
    try {
      const out = await this.ethCall({ to: address, data: OWNER.encodeFunctionData("owner") }, expected);
      if (out.length !== 66 || !/^0x0{24}/.test(out)) return null;
      return OWNER.decodeFunctionResult("owner", out)[0] as string;
    } catch {
      return null; // no owner(), or it reverted (e.g. an uninitialized implementation)
    }
  }

  /** DEFAULT_ADMIN_ROLE plus every no-argument *_ROLE() constant of the ABI, as [name, id]. */
  private async roleIds(address: string, iface: Interface): Promise<[string, string][]> {
    const out: [string, string][] = [["DEFAULT_ADMIN_ROLE", ZeroHash]];
    const names: string[] = [];
    iface.forEachFunction((f) => {
      if (f.name.endsWith("_ROLE") && f.inputs.length === 0 && f.name !== "DEFAULT_ADMIN_ROLE") names.push(f.name);
    });
    for (const name of names.sort()) {
      try {
        const id = iface.decodeFunctionResult(name, await this.ethCall({ to: address, data: iface.encodeFunctionData(name) }))[0] as string;
        out.push([name, id]);
      } catch {
        // constant not readable on this deployment
      }
    }
    return out;
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
    const out = await this.ethCall({ to, data });
    return out === "0x" ? 0n : (ERC20.decodeFunctionResult(fn, out)[0] as bigint);
  }

  /** Proxies decode with the ABIs of the implementations they have pointed at. */
  private registerProxies(proxies: ProxyAbis, impl: Map<string, string>): void {
    for (const [proxy, slot] of sortedEntries(impl)) {
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
    perCall: { eth: TransferT[]; logs: RawLog[] }[];
    storage: Map<string, { before: string; after: string }>;
    before: Snapshot;
    after: Snapshot;
    allowanceBefore: Map<string, bigint>;
    allowanceAfter: Map<string, bigint>;
    rolesBefore: Map<string, boolean>;
    rolesAfter: Map<string, boolean>;
    proxies: ProxyAbis;
    codes: Map<string, string>;
    facts: SimulationResultT["events"];
  }): Omit<SimulationResultT, "bytecodeHash" | "simHash"> {
    const { book } = this.d;
    const logs = x.perCall.flatMap((c) => c.logs);
    const events = [...x.facts, ...logs.map((l) => decodeLog(book, x.proxies, l))];
    const addr = (t: string | undefined) => getAddress(`0x${(t ?? "").slice(-40)}`);
    const erc20Transfers = (ls: RawLog[]) => ls.filter((l) => l.topics[0] === TRANSFER && l.topics.length === 3).map((l) => ({ token: getAddress(l.address), from: addr(l.topics[1]), to: addr(l.topics[2]), amount: BigInt(l.data).toString() }));
    // Per call: ETH moves (from the call trace), then token transfers (from its logs), in execution order.
    const tokenTransfers = x.perCall.flatMap((c) => [...c.eth, ...erc20Transfers(c.logs)]);
    const approvals = logs.filter((l) => l.topics[0] === APPROVAL && l.topics.length === 3).map((l) => ({ token: getAddress(l.address), owner: addr(l.topics[1]), spender: addr(l.topics[2]), amount: BigInt(l.data).toString() }));

    // State is the ground truth; events can be omitted. Report changes the logs do not explain (sorted: map order is async).
    const unlogged: SimulationResultT["events"] = [];
    for (const [key, after] of sortedEntries(x.allowanceAfter)) {
      const beforeAmt = x.allowanceBefore.get(key) ?? 0n;
      if (after === beforeAmt) continue;
      const [token, owner, spender] = key.split("|") as [string, string, string];
      if (approvals.some((a) => a.token.toLowerCase() === token.toLowerCase() && a.owner.toLowerCase() === owner && a.spender.toLowerCase() === spender)) continue;
      approvals.push({ token: getAddress(token), owner: getAddress(owner), spender: getAddress(spender), amount: after.toString() });
      unlogged.push({ contract: getAddress(token), name: "UnloggedAllowanceChange", args: { owner: getAddress(owner), spender: getAddress(spender), before: beforeAmt.toString(), after: after.toString() } });
    }
    for (const [key, afterBal] of sortedEntries(x.after.balances)) {
      const beforeBal = x.before.balances.get(key) ?? 0n;
      const [token, holder] = key.split("|") as [string, string];
      const logged = tokenTransfers.filter((t) => t.token.toLowerCase() === token.toLowerCase()).reduce((s, t) => s + (t.to.toLowerCase() === holder ? BigInt(t.amount) : 0n) - (t.from.toLowerCase() === holder ? BigInt(t.amount) : 0n), 0n);
      if (afterBal - beforeBal !== logged) {
        unlogged.push({ contract: getAddress(token), name: "UnloggedBalanceChange", args: { account: getAddress(holder), before: beforeBal.toString(), after: afterBal.toString(), loggedDelta: logged.toString() } });
      }
    }

    const ownershipChanges: SimulationResultT["ownershipChanges"] = [];
    for (const [c, ownerAfter] of sortedEntries(x.after.owner)) {
      const ownerBefore = x.before.owner.get(c);
      if (ownerBefore && ownerBefore.toLowerCase() !== ownerAfter.toLowerCase()) ownershipChanges.push({ contract: getAddress(c), role: "owner", before: ownerBefore, after: ownerAfter });
    }
    for (const [c, adminAfter] of sortedEntries(x.after.admin)) {
      const adminBefore = x.before.admin.get(c) ?? ZERO32;
      if (adminBefore !== adminAfter) ownershipChanges.push({ contract: getAddress(c), role: "proxyAdmin", before: slotToAddress(adminBefore), after: slotToAddress(adminAfter) });
    }
    // Post-execution privilege probe: a granted role reads ZeroAddress -> account, a revoked one account -> ZeroAddress.
    for (const [key, has] of sortedEntries(x.rolesAfter)) {
      const had = x.rolesBefore.get(key);
      if (had === undefined || had === has) continue;
      const [contract, role, account] = key.split("|") as [string, string, string];
      ownershipChanges.push({ contract: getAddress(contract), role, before: had ? getAddress(account) : ZeroAddress, after: has ? getAddress(account) : ZeroAddress });
    }

    const implementationChanges: SimulationResultT["implementationChanges"] = [];
    for (const [proxy, implAfter] of sortedEntries(x.after.impl)) {
      const implBefore = x.before.impl.get(proxy) ?? ZERO32;
      if (implBefore === implAfter) continue;
      const oldAddr = slotToAddress(implBefore);
      const newAddr = slotToAddress(implAfter);
      const oldCode = implBefore === ZERO32 ? "0x" : (x.codes.get(oldAddr.toLowerCase()) ?? "0x");
      const newCode = x.codes.get(newAddr.toLowerCase()) ?? "0x";
      // Selectors straight from bytecode (no ABI or source needed); names from known ABIs, then the 4-byte table.
      const o = new Set(extractSelectors(oldCode));
      const n = new Set(extractSelectors(newCode));
      const ref = (selector: string) => {
        const signature = this.resolver.resolve(selector);
        return signature ? { selector, signature } : { selector };
      };
      implementationChanges.push({
        proxy: getAddress(proxy),
        before: oldAddr,
        after: newAddr,
        addedSelectors: [...n].filter((s) => !o.has(s)).map(ref),
        removedSelectors: [...o].filter((s) => !n.has(s)).map(ref),
      });
      const ops = scanOpcodes(newCode);
      const was = scanOpcodes(oldCode);
      if (ops.delegatecall) unlogged.push({ contract: newAddr, name: "NewImplementationHasDelegatecall", args: { proxy: getAddress(proxy), inPreviousImplementation: was.delegatecall } });
      if (ops.selfdestruct) unlogged.push({ contract: newAddr, name: "NewImplementationHasSelfdestruct", args: { proxy: getAddress(proxy), inPreviousImplementation: was.selfdestruct } });
    }

    const storageDiffs = [...x.storage]
      .filter(([, v]) => v.before !== v.after)
      .map(([key, v]) => {
        const [contract, slot] = key.split("|") as [string, string];
        return { contract: getAddress(contract), slot, before: v.before, after: v.after };
      })
      .sort(byKey((s) => `${s.contract.toLowerCase()}|${s.slot}`));

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
      events: [...events, ...unlogged],
    };
  }
}
