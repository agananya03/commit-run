// Nested calldata decoding with synthetic ABIs (no chain): multicall(bytes[]), execute(target, value, data) and
// upgradeToAndCall(impl, data), recursively.
import { Interface, MaxUint256 } from "ethers";
import { describe, expect, it } from "vitest";
import { decodeCall, decodeRevert } from "../src/decode.js";
import { ContractBook } from "../src/deployments.js";

const A = {
  safe: "0x1000000000000000000000000000000000000001",
  token: "0x2000000000000000000000000000000000000002",
  proxy: "0x3000000000000000000000000000000000000003",
  impl: "0x4000000000000000000000000000000000000004",
  alice: "0x5000000000000000000000000000000000000005",
};
const SAFE = ["function execute(address target, uint256 value, bytes data)", "function multicall(bytes[] calls)", "error Nope(uint256 code)"];
const TOKEN = ["function approve(address spender, uint256 amount)", "function transfer(address to, uint256 amount)"];
const PROXY = ["function upgradeToAndCall(address impl, bytes data)"];
const IMPL = ["function reinitializeV2(address newOwner)"];
const book = new ContractBook({
  chainId: 31337,
  deployBlock: 1,
  contracts: {
    Safe: { address: A.safe, abi: new Interface(SAFE).fragments.map((f) => JSON.parse(f.format("json"))) },
    Token: { address: A.token, abi: new Interface(TOKEN).fragments.map((f) => JSON.parse(f.format("json"))) },
    Proxy: { address: A.proxy, abi: new Interface(PROXY).fragments.map((f) => JSON.parse(f.format("json"))) },
    Impl: { address: A.impl, abi: new Interface(IMPL).fragments.map((f) => JSON.parse(f.format("json"))) },
  },
});
const safe = new Interface(SAFE);
const token = new Interface(TOKEN);
const proxy = new Interface(PROXY);
const impl = new Interface(IMPL);
const sig = (calls: { contractName?: string | undefined; signature?: string | undefined; target: string }[]) => calls.map((c) => `${c.contractName}.${c.signature}@${c.target.slice(0, 4)}`);

describe("decodeCall", () => {
  it("decodes execute(target, value, data) with the target's ABI", () => {
    const data = safe.encodeFunctionData("execute", [A.token, 0, token.encodeFunctionData("approve", [A.alice, MaxUint256])]);
    expect(sig(decodeCall(book, new Map(), A.safe, data, 0n))).toEqual(["Safe.execute(address,uint256,bytes)@0x10", "Token.approve(address,uint256)@0x20"]);
  });

  it("decodes multicall(bytes[]) element by element, recursively", () => {
    const inner = safe.encodeFunctionData("execute", [A.token, 0, token.encodeFunctionData("transfer", [A.alice, 5])]);
    const data = safe.encodeFunctionData("multicall", [[inner, safe.encodeFunctionData("execute", [A.proxy, 0, proxy.encodeFunctionData("upgradeToAndCall", [A.impl, impl.encodeFunctionData("reinitializeV2", [A.alice])])])]]);
    expect(sig(decodeCall(book, new Map(), A.safe, data, 0n))).toEqual([
      "Safe.multicall(bytes[])@0x10",
      "Safe.execute(address,uint256,bytes)@0x10",
      "Token.transfer(address,uint256)@0x20",
      "Safe.execute(address,uint256,bytes)@0x10",
      "Proxy.upgradeToAndCall(address,bytes)@0x30",
      "Impl (delegatecall).reinitializeV2(address)@0x30", // runs in the proxy's context
    ]);
  });

  it("keeps an unknown call (selector only) instead of failing", () => {
    const [call] = decodeCall(book, new Map(), A.alice, "0xdeadbeef00", 0n);
    expect(call).toMatchObject({ selector: "0xdeadbeef", args: [] });
  });

  it("returns args as JSON-safe values", () => {
    const [call] = decodeCall(book, new Map(), A.token, token.encodeFunctionData("approve", [A.alice, MaxUint256]), 0n);
    expect(call?.args).toEqual([A.alice, MaxUint256.toString()]);
  });
});

describe("decodeRevert", () => {
  it("decodes custom errors, Error(string) and Panic", () => {
    expect(decodeRevert(book, safe.encodeErrorResult("Nope", [7]))).toBe("Nope(7)");
    expect(decodeRevert(book, new Interface(["error Error(string)"]).encodeErrorResult("Error", ["boom"]))).toBe("boom");
    expect(decodeRevert(book, "0x4e487b710000000000000000000000000000000000000000000000000000000000000011")).toBe("Panic(0x11)");
    expect(decodeRevert(book, "0x")).toBe("reverted without a reason");
  });
});
