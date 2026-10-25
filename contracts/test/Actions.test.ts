import { expect } from "chai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import { encodeActions, hardhatAddress, type Action, type Deployments } from "../scripts/lib/actions";

const repo = join(__dirname, "..", "..");
const read = <T>(p: string): T => JSON.parse(readFileSync(join(repo, p), "utf8")) as T;
// The shared mock's deployments have the same deterministic addresses as a fresh deploy:seed.
const deployments = read<Deployments>("shared/mocks/deployments.json");

describe("governance action encoder", () => {
  it("encodes MIP-21 exactly like the backend did for the shared mock (independent implementation)", () => {
    const { targets, values, calldatas } = encodeActions(read<Action[]>("data/scenarios/MIP-21/onchain_actions.json"), deployments);
    const chunk = read<{ id: string; text: string }[]>("shared/mocks/ingest.MIP-21.json").find((c) => c.id === "MIP-21:onchain:0")!;
    expect(calldatas).to.deep.equal(/calldatas=\[(.*?)\]/.exec(chunk.text)![1]!.split(","));
    expect(targets).to.deep.equal([deployments.contracts.VaultProxy!.address, deployments.contracts.Treasury!.address]);
    expect(values).to.deep.equal([0n, 0n]);
  });

  it("encodes MIP-12 as Treasury.transfer(USDC, #9, 400k USDC), filling in the token", () => {
    const { targets, calldatas } = encodeActions(read<Action[]>("data/scenarios/MIP-12/onchain_actions.json"), deployments);
    const treasury = new ethers.Interface(deployments.contracts.Treasury!.abi as ethers.InterfaceAbi);
    const decoded = treasury.parseTransaction({ data: calldatas[0]! })!;
    expect(targets).to.deep.equal([deployments.contracts.Treasury!.address]);
    expect(decoded.signature).to.equal("transfer(address,address,uint256)");
    expect([...decoded.args]).to.deep.equal([deployments.contracts.MockUSDC!.address, hardhatAddress(9), 400_000_000_000n]);
  });

  it("rejects unknown contracts and functions with the action index", () => {
    expect(() => encodeActions([{ contract: "Nope", function: "x", args: [] }], deployments)).to.throw(/action 0 \(Nope\.x\): unknown contract/);
    expect(() => encodeActions([{ contract: "Treasury", function: "steal", args: [] }], deployments)).to.throw(/function steal not in ABI/);
  });
});
