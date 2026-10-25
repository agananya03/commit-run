import { ethers } from "ethers";

/**
 * Encodes D's human-readable on-chain actions (data/scenarios/<id>/onchain_actions.json) into the exact
 * targets/values/calldatas of a Governor proposal, using the deployed addresses and ABIs. Same rules as the
 * backend's src/chain/actions.ts (kept separate because /contracts is CommonJS and /backend is ESM):
 * - address args: Hardhat account index, deployments name ("USDC" = MockUSDC, "VaultV2"), or a 0x address
 * - uint args: number, decimal string, or "max"
 * - bytes args: a nested call "fn(arg, ...)" encoded with the target's ABI (the reinitializer in upgradeToAndCall)
 * - a call one argument short whose first param is `token` gets USDC (Treasury.transfer(to, amount))
 */

export interface Deployments {
  chainId: number;
  deployBlock: number;
  contracts: Record<string, { address: string; abi: unknown[]; decimals?: number }>;
}

export interface Action {
  contract: string;
  function: string;
  args: unknown[];
}

export interface EncodedProposal {
  targets: string[];
  values: bigint[];
  calldatas: string[];
}

const MNEMONIC = "test test test test test test test test test test test junk";
const ALIASES: Record<string, string> = { Vault: "VaultProxy", USDC: "MockUSDC", MRD: "MeridianToken", Timelock: "GuardedTimelock", Governor: "MeridianGovernor" };

export const hardhatAddress = (index: number): string => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).address;
export const hardhatKey = (index: number): string => ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).privateKey;

function entry(name: string, d: Deployments): { address: string; iface: ethers.Interface } {
  const key = ALIASES[name] ?? name;
  const c = d.contracts[key];
  if (!c) throw new Error(`unknown contract ${name}`);
  // The proxy's ABI is V1; the reinitializer the upgrade calls lives on V2.
  const abi = key === "VaultProxy" && d.contracts.VaultV2 ? [...c.abi, ...d.contracts.VaultV2.abi] : c.abi;
  const seen = new Set<string>();
  const unique = abi.filter((f) => {
    const k = JSON.stringify(f);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { address: ethers.getAddress(c.address), iface: new ethers.Interface(unique as ethers.InterfaceAbi) };
}

function encodeCall(iface: ethers.Interface, fnName: string, raw: unknown[], d: Deployments): string {
  const fns = iface.fragments.filter((f): f is ethers.FunctionFragment => ethers.FunctionFragment.isFragment(f) && f.name === fnName);
  if (fns.length === 0) throw new Error(`function ${fnName} not in ABI`);
  let fn = fns.find((f) => f.inputs.length === raw.length);
  let args = raw;
  if (!fn) {
    fn = fns.find((f) => f.inputs.length === raw.length + 1 && f.inputs[0]?.name === "token");
    if (!fn) throw new Error(`no ${fnName} overload takes ${raw.length} args`);
    args = ["USDC", ...raw];
  }
  return iface.encodeFunctionData(fn, fn.inputs.map((p, i) => coerce(p, args[i], iface, d)));
}

function coerce(p: ethers.ParamType, v: unknown, iface: ethers.Interface, d: Deployments): unknown {
  if (p.type === "address") {
    if (typeof v === "number") return hardhatAddress(v);
    if (typeof v === "string" && ethers.isAddress(v)) return ethers.getAddress(v);
    if (typeof v === "string") return entry(v, d).address;
  }
  if (p.type.startsWith("uint")) {
    if (v === "max") return ethers.MaxUint256;
    if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) return BigInt(v);
  }
  if (p.type === "bytes" && typeof v === "string") {
    if (/^0x[0-9a-fA-F]*$/.test(v)) return v;
    const m = /^(\w+)\((.*)\)$/.exec(v.trim());
    if (m) {
      const inner = m[2]!.trim() === "" ? [] : m[2]!.split(",").map((s) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : s.trim()));
      return encodeCall(iface, m[1]!, inner, d);
    }
  }
  if (p.type === "bool") return v === true || v === "true";
  if (p.type === "string") return String(v);
  throw new Error(`cannot use ${JSON.stringify(v)} as ${p.type} ${p.name}`);
}

export function encodeActions(actions: Action[], d: Deployments): EncodedProposal {
  if (actions.length === 0) throw new Error("no on-chain actions");
  const encoded = actions.map((a, i) => {
    try {
      const { address, iface } = entry(a.contract, d);
      return { target: address, data: encodeCall(iface, a.function, a.args, d) };
    } catch (err) {
      throw new Error(`action ${i} (${a.contract}.${a.function}): ${(err as Error).message}`);
    }
  });
  return { targets: encoded.map((e) => e.target), values: encoded.map(() => 0n), calldatas: encoded.map((e) => e.data) };
}
