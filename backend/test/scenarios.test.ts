import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { hardhatAddress, loadScenarios, resolveTitle } from "../src/seed/scenarios.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures", import.meta.url));
const sha = (path: string): string => `0x${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

describe("loadScenarios", () => {
  const { plans, errors } = loadScenarios(fixtures, repoRoot);
  const mip21 = plans.find((p) => p.slug === "MIP-21");

  it("reads only MIP-* folders, sorted, with no errors", () => {
    expect(errors).toEqual([]);
    expect(plans.map((p) => p.slug)).toEqual(["MIP-12", "MIP-21"]);
  });

  it("maps scenario files to evidence types and excludes votes.json and expected.json", () => {
    expect(mip21?.files.map((f) => f.type).sort()).toEqual(["disclosure", "forum", "onchain", "pdf", "social"]);
    expect(mip21?.files.some((f) => /votes|expected/.test(f.uri))).toBe(false);
  });

  it("hashes the exact file bytes and records size and repo-relative uri", () => {
    const pdf = mip21?.files.find((f) => f.type === "pdf");
    const path = join(fixtures, "scenarios", "MIP-21", "proposal.pdf");
    expect(pdf?.sha256).toBe(sha(path));
    expect(pdf?.sha256).toMatch(/^0x[0-9a-f]{64}$/);
    expect(pdf?.bytes).toBe(readFileSync(path).length);
    expect(pdf?.uri).toBe("backend/test/fixtures/scenarios/MIP-21/proposal.pdf");
  });

  it("resolves the proposer from a Hardhat index or an address, lowercased", () => {
    expect(mip21?.proposer).toBe("0x1cbd3b2770909d4e10f157cabc84c7264073c9ec"); // Hardhat #13
    expect(plans.find((p) => p.slug === "MIP-12")?.proposer).toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
  });

  it("takes the title from forum_thread.json (title or topic.title)", () => {
    expect(mip21?.title).toBe("VaultV2: storage packing and gas optimisation");
    expect(plans.find((p) => p.slug === "MIP-12")?.title).toBe("MIP-12: SDK grant");
    expect(resolveTitle(null, "MIP-99")).toBe("MIP-99");
  });
});

describe("loadScenarios edge cases", () => {
  const tmp = mkdtempSync(join(tmpdir(), "poi-seed-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("treats a missing scenarios folder as empty, not an error", () => {
    expect(loadScenarios(join(tmp, "nope"), repoRoot)).toEqual({ plans: [], errors: [] });
  });

  it("reads D's disclosure format (proposerIndex)", () => {
    const dir = join(tmp, "d-format", "scenarios", "MIP-88");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "disclosure.json"), JSON.stringify({ synthetic: true, proposerIndex: 13, walletIndices: [13], statement: "x" }));
    writeFileSync(join(dir, "forum_thread.json"), JSON.stringify({ topic_id: 1, title: "[MIP-88] t", posts: [] }));
    const { plans, errors } = loadScenarios(join(tmp, "d-format"), repoRoot);
    expect(errors).toEqual([]);
    expect(plans[0]).toMatchObject({ slug: "MIP-88", title: "[MIP-88] t", proposer: "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec" });
  });

  it("reports a scenario without a proposer instead of crashing the whole seed", () => {
    const dir = join(tmp, "scenarios", "MIP-77");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "forum_thread.json"), JSON.stringify({ title: "no proposer" }));
    const { plans, errors } = loadScenarios(tmp, repoRoot);
    expect(plans).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ slug: "MIP-77" });
    expect(errors[0]?.message).toMatch(/no proposer/);
  });
});

describe("hardhatAddress", () => {
  it("derives the default Hardhat accounts", () => {
    expect(hardhatAddress(0)).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(hardhatAddress(14)).toBe("0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097");
  });
});
