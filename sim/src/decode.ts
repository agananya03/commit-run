import { AbiCoder, getAddress, Interface, type Log, type ParamType, type Result, type TransactionDescription } from "ethers";
import type { ContractBook } from "./deployments.js";
import type { DecodedCallT, SimulationResultT } from "./schema.js";

const MAX_DEPTH = 4;
const ERC20 = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

/** Extra ABIs per proxy (its implementations), so calls/events through a proxy decode with the right functions. */
export type ProxyAbis = Map<string, Interface[]>;

/** bigint -> decimal string, ethers Result -> plain array, recursively. */
export function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  return v;
}

const ifacesFor = (book: ContractBook, proxies: ProxyAbis, address: string): Interface[] => {
  const own = book.at(address)?.iface;
  return [...(own ? [own] : []), ...(proxies.get(address.toLowerCase()) ?? [])];
};

function parseWith(ifaces: Interface[], data: string, value: bigint): TransactionDescription | null {
  for (const iface of ifaces) {
    try {
      const tx = iface.parseTransaction({ data, value });
      if (tx) return tx;
    } catch {
      // not this ABI
    }
  }
  return null;
}

/**
 * Decodes one call and, recursively, any calldata nested in its bytes / bytes[] arguments:
 * - a bytes arg is decoded with the ABI of an address arg of the same call when that parses (upgradeToAndCall(impl, data),
 *   execute(target, value, data)), else with the target's own ABI (multicall(bytes[]));
 * - upgradeTo* nested calls run in the proxy's context (delegatecall); others are calls to that address.
 * Returns the outer call first, then nested calls depth-first.
 */
export function decodeCall(book: ContractBook, proxies: ProxyAbis, target: string, data: string, value: bigint, depth = 0, label?: string): DecodedCallT[] {
  const known = book.at(target);
  const selector = data.slice(0, 10);
  const tx = data.length >= 10 ? parseWith(ifacesFor(book, proxies, target), data, value) : null;
  const contractName = label ?? known?.name;
  if (!tx) return [{ target: getAddress(target), ...(contractName ? { contractName } : {}), selector, args: [] }];

  const out: DecodedCallT[] = [{ target: getAddress(target), ...(contractName ? { contractName } : {}), selector, signature: tx.fragment.format("sighash"), args: jsonSafe([...tx.args]) as unknown[] }];
  if (depth >= MAX_DEPTH) return out;

  const inputs = tx.fragment.inputs;
  const addressArgs = inputs.map((p, i) => (p.type === "address" ? (tx.args[i] as string) : null)).filter((a): a is string => a !== null);
  const delegate = tx.fragment.name.startsWith("upgradeTo");

  const nested = (bytes: string): DecodedCallT[] => {
    if (!/^0x[0-9a-fA-F]{8}/.test(bytes)) return [];
    for (const addr of addressArgs) {
      if (!parseWith(ifacesFor(book, proxies, addr), bytes, 0n)) continue;
      const name = book.at(addr)?.name;
      return delegate
        ? decodeCallWith(book, proxies, target, bytes, ifacesFor(book, proxies, addr), depth + 1, `${name ?? addr} (delegatecall)`)
        : decodeCall(book, proxies, addr, bytes, 0n, depth + 1);
    }
    return parseWith(ifacesFor(book, proxies, target), bytes, 0n) ? decodeCall(book, proxies, target, bytes, 0n, depth + 1) : [];
  };

  inputs.forEach((p: ParamType, i: number) => {
    if (p.type === "bytes") out.push(...nested(tx.args[i] as string));
    if (p.type === "bytes[]") for (const b of tx.args[i] as Result) out.push(...nested(b as string));
  });
  return out;
}

/** Decode with explicit ABIs (the implementation's) while reporting the proxy as the target. */
function decodeCallWith(book: ContractBook, proxies: ProxyAbis, target: string, data: string, ifaces: Interface[], depth: number, label: string): DecodedCallT[] {
  const temp: ProxyAbis = new Map(proxies);
  temp.set(target.toLowerCase(), [...(proxies.get(target.toLowerCase()) ?? []), ...ifaces]);
  return decodeCall(book, temp, target, data, 0n, depth, label);
}

type EventT = SimulationResultT["events"][number];

/** Named, JSON-safe args; unknown events are kept (as UnknownEvent with topic0) rather than dropped. */
export function decodeLog(book: ContractBook, proxies: ProxyAbis, log: Pick<Log, "address" | "topics" | "data">): EventT {
  for (const iface of [...ifacesFor(book, proxies, log.address), ERC20]) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;
      const args: Record<string, unknown> = {};
      parsed.fragment.inputs.forEach((input, i) => {
        args[input.name || `arg${i}`] = jsonSafe(parsed.args[i]);
      });
      return { contract: getAddress(log.address), name: parsed.name, args };
    } catch {
      // try the next ABI
    }
  }
  return { contract: getAddress(log.address), name: "UnknownEvent", args: { topic0: log.topics[0] ?? null, data: log.data } };
}

const coder = AbiCoder.defaultAbiCoder();

/** Revert data -> readable reason: custom errors from known ABIs, Error(string), Panic(uint256). */
export function decodeRevert(book: ContractBook, data: string | null | undefined): string {
  if (!data || data === "0x") return "reverted without a reason";
  if (data.startsWith("0x08c379a0")) return coder.decode(["string"], `0x${data.slice(10)}`)[0] as string;
  if (data.startsWith("0x4e487b71")) return `Panic(0x${(coder.decode(["uint256"], `0x${data.slice(10)}`)[0] as bigint).toString(16)})`;
  for (const c of book.all()) {
    try {
      const err = c.iface.parseError(data);
      if (err) return `${err.name}(${err.args.map((a) => String(jsonSafe(a))).join(", ")})`;
    } catch {
      // not this ABI
    }
  }
  return `reverted with unknown error ${data.slice(0, 10)}`;
}
