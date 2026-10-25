import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { rpcReachable } from "../src/rpc.js";

const logger = pino({ level: "silent" });

describe("GET /health", () => {
  it("is ok when the fork answers", async () => {
    const app = createApp({ logger, forkReachable: async () => true });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ service: "sim", status: "ok", mocks: false, deps: { fork: "ok" } });
  });

  it("is degraded when the fork is down", async () => {
    const app = createApp({ logger, forkReachable: async () => false });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "degraded", deps: { fork: "down" } });
  });
});

describe("POST /simulate validation", () => {
  const app = createApp({ logger, forkReachable: async () => true });

  it.each([
    ["mismatched array lengths", { proposalId: "MIP-1", targets: ["0x5FbDB2315678afecb367f032d93F642f64180aa3"], values: [], calldatas: [] }],
    ["a malformed address", { proposalId: "MIP-1", targets: ["0x1234"], values: ["0"], calldatas: ["0x"] }],
    ["an extra field", { proposalId: "MIP-1", targets: ["0x5FbDB2315678afecb367f032d93F642f64180aa3"], values: ["0"], calldatas: ["0x"], x: 1 }],
  ])("rejects %s with 400 before touching the chain", async (_label, body) => {
    // No simulator wired: a request that passes validation would get 502, so 400 proves validation ran first.
    const withSim = createApp({ logger, forkReachable: async () => true, simulator: { simulate: () => Promise.reject(new Error("must not run")) } as never });
    const res = await request(withSim).post("/simulate").send(body).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("is 502 when no simulator is configured", async () => {
    const res = await request(app).post("/simulate").send({ proposalId: "MIP-1", targets: ["0x5FbDB2315678afecb367f032d93F642f64180aa3"], values: ["0"], calldatas: ["0x"] }).expect(502);
    expect(res.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});

describe("config", () => {
  it("defaults to port 4002, the Anvil fork on 8546 and the Hardhat node on 8545", () => {
    expect(loadConfig({})).toMatchObject({ PORT: 4002, ANVIL_URL: "http://127.0.0.1:8546", RPC_URL: "http://127.0.0.1:8545" });
    expect(loadConfig({}).DEPLOYMENTS_FILE).toMatch(/contracts\/deployments\/localhost\.json$/);
  });

  it("rejects a malformed URL", () => {
    expect(() => loadConfig({ ANVIL_URL: "not a url" })).toThrow();
  });
});

describe("rpcReachable", () => {
  it("returns false for a closed port instead of throwing", async () => {
    await expect(rpcReachable("http://127.0.0.1:1", 500)).resolves.toBe(false);
  });
});
