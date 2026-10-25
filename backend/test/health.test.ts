import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv } from "../src/env.js";

const logger = pino({ level: "silent" });

describe("GET /health", () => {
  it("is ok when every dependency is up", async () => {
    const app = createApp({ logger, mocks: true, checks: { postgres: async () => true } });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ service: "backend", status: "ok", mocks: true, deps: { postgres: "ok" } });
  });

  it("is degraded when any dependency is down", async () => {
    const app = createApp({ logger, mocks: false, checks: { postgres: async () => false, redis: async () => true } });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "degraded", deps: { postgres: "down", redis: "ok" } });
  });
});

describe("env", () => {
  it("requires a postgres DATABASE_URL and defaults the rest", () => {
    expect(() => loadEnv({})).toThrow();
    expect(loadEnv({ DATABASE_URL: "postgresql://u:p@localhost:5433/db" })).toMatchObject({ PORT: 4000, USE_MOCKS: true });
  });
});
