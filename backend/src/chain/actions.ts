import { FunctionFragment, getAddress, Interface, isAddress, MaxUint256, type ParamType } from "ethers";
import type { SimulateRequest } from "../../../shared/schemas/types.js";
import { hardhatAddress } from "../seed/scenarios.js";
import type { DeploymentsT } from "./contracts.js";

/**
 * Turns D's human-readable on-chain actions (data/scenarios/<id>/onchain_actions.json) into the exact
 * targets/values/calldatas a Governor proposal carries, using the deployed ABIs:
 *
 *   { "contract": "Treasury", "function": "transfer", "args": [9, "400000000000"] }
 *   { "contract": "Vault", "function": "upgradeToAndCall", "args": ["VaultV2", "reinitializeV2(14)"] }
 *   { "contract": "Treasury", "function": "approve", "args": ["USDC", 14, "max"] }
 *
 * Argument rules (by Solidity param type):
 * - address: a Hardhat account index, a deployments contract name ("USDC" = MockUSDC), or a literal 0x address
 * - uintN:   a number, a decimal string, or "max" (type(uint256).max)
 * - bytes:   a nested call "fn(arg, ...)" encoded with the target's ABI (e.g. the reinitializer in upgradeToAndCall)
 * - A call one argument short whose first param is `token` gets USDC (Treasury.transfer(to, amount) in D's data).
 */

export interface OnchainAction {
  contract: string;
  function: string;
  args: unknown[];
}

/** D's short names -> deployments keys. The vault is called through its proxy. */
const ALIASES: Record<string, string> = { Vault: "VaultProxy", USDC: "MockUSDC", MRD: "MeridianToken", Timelock: "GuardedTimelock", Governor: "MeridianGovernor" };

export class ActionEncodingError extends Error {}

export function encodeActions(raw: unknown, deployments: DeploymentsT, proposalId: string): SimulateRequest {
  const actions = parseActions(raw);
  const encoded = actions.map((a, i) => {
    try {
      return encodeOne(a, deployments);
    } catch (err) {
      throw new ActionEncodingError(`action ${i} (${a.contract}.${a.function}): ${(err as Error).message}`);
    }
  });
  return {
    proposalId,
    targets: encoded.map((e) => e.target),
    values: encoded.map(() => "0"),
    calldatas: encoded.map((e) => e.data),
  };
}

function parseActions(raw: unknown): OnchainAction[] {
  const list = Array.isArray(raw) ? raw : (raw as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(list) || list.length === 0) throw new ActionEncodingError("no on-chain actions in the version (onchain_actions.json missing or empty)");
  return list.map((a, i) => {
    const o = a as Partial<OnchainAction>;
    if (typeof o.contract !== "string" || typeof o.function !== "string" || !Array.isArray(o.args)) {
      throw new ActionEncodingError(`action ${i} must have contract, function and args`);
    }
    return { contract: o.contract, function: o.function, args: o.args };
  });
}

function entryFor(name: string, d: DeploymentsT): { key: string; address: string; abi: Interface } {
  const key = ALIASES[name] ?? name;
  const entry = d.contracts[key];
  if (!entry) throw new Error(`unknown contract ${name}`);
  // The proxy's ABI is V1; calls the upgrade introduces (reinitializeV2) live on V2.
  const abiSource = key === "VaultProxy" && d.contracts.VaultV2 ? [...entry.abi, ...d.contracts.VaultV2.abi] : entry.abi;
  return { key, address: getAddress(entry.address), abi: new Interface(dedupe(abiSource) as never) };
}

function encodeOne(a: OnchainAction, d: DeploymentsT): { target: string; data: string } {
  const { address, abi } = entryFor(a.contract, d);
  return { target: address, data: encodeCall(abi, a.function, a.args, d) };
}

function encodeCall(abi: Interface, fnName: string, rawArgs: unknown[], d: DeploymentsT): string {
  const candidates = abi.fragments.filter((f): f is FunctionFragment => FunctionFragment.isFragment(f) && f.name === fnName);
  if (candidates.length === 0) throw new Error(`function ${fnName} not in ABI`);
  let fn = candidates.find((f) => f.inputs.length === rawArgs.length);
  let args = rawArgs;
  if (!fn) {
    fn = candidates.find((f) => f.inputs.length === rawArgs.length + 1 && f.inputs[0]?.name === "token");
    if (!fn) throw new Error(`no ${fnName} overload takes ${rawArgs.length} args`);
    args = ["USDC", ...rawArgs];
  }
  const values = fn.inputs.map((p, i) => coerce(p, args[i], abi, d));
  return abi.encodeFunctionData(fn, values);
}

function coerce(p: ParamType, v: unknown, abi: Interface, d: DeploymentsT): unknown {
  if (p.type === "address") {
    if (typeof v === "number") return hardhatAddress(v);
    if (typeof v === "string" && isAddress(v)) return getAddress(v);
    if (typeof v === "string") return entryFor(v, d).address;
    throw new Error(`cannot use ${JSON.stringify(v)} as address ${p.name}`);
  }
  if (p.type.startsWith("uint")) {
    if (v === "max") return MaxUint256;
    if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) return BigInt(v);
    throw new Error(`cannot use ${JSON.stringify(v)} as ${p.type} ${p.name}`);
  }
  if (p.type === "bytes" && typeof v === "string") {
    if (/^0x[0-9a-fA-F]*$/.test(v)) return v;
    const m = /^(\w+)\((.*)\)$/.exec(v.trim());
    if (!m) throw new Error(`cannot use ${JSON.stringify(v)} as bytes ${p.name}`);
    const inner = m[2]!.trim() === "" ? [] : m[2]!.split(",").map((s) => parseLiteral(s.trim()));
    return encodeCall(abi, m[1]!, inner, d);
  }
  if (p.type === "bool") return v === true || v === "true";
  if (p.type === "string") return String(v);
  throw new Error(`unsupported param type ${p.type}`);
}

/** Literals inside "fn(14, USDC, max)": numbers become numbers, everything else stays a string. */
const parseLiteral = (s: string): unknown => (/^\d+$/.test(s) && s.length < 16 ? Number(s) : s.replace(/^["']|["']$/g, ""));

function dedupe(abi: unknown[]): unknown[] {
  const seen = new Set<string>();
  return abi.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
