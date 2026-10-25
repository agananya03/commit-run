import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { rpcReachable } from "../src/rpc.js";

const logger = pino({ level: "silent" });

describe("GET /health", () => {
  it("is ok when the fork answers", async () => {
    const app = createApp({ logger, mocks: false, forkReachable: async () => true });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ service: "sim", status: "ok", mocks: false, deps: { fork: "ok" } });
  });

  it("is degraded when the fork is down", async () => {
    const app = createApp({ logger, mocks: true, forkReachable: async () => false });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "degraded", mocks: true, deps: { fork: "down" } });
  });
});

describe("config", () => {
  it("defaults to port 4002, the Anvil fork on 8546 and mocks on", () => {
    expect(loadConfig({})).toMatchObject({ PORT: 4002, ANVIL_URL: "http://127.0.0.1:8546", USE_MOCKS: true });
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
