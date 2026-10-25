import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pino } from "pino";
import { io as connect, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PipelineProgress } from "../../shared/schemas/types.js";
import { createApp } from "../src/app.js";
import { attachSocket, type EventBus } from "../src/events.js";

const logger = pino({ level: "silent" });
let http: Server;
let bus: EventBus;
let url = "";
let closeIo: () => Promise<void>;

beforeAll(async () => {
  http = createServer(createApp({ logger, mocks: true, checks: {} }));
  const attached = attachSocket(http, "http://localhost:3000", logger);
  bus = attached.bus;
  closeIo = () => attached.io.close();
  await new Promise<void>((resolve) => http.listen(0, resolve));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await closeIo();
});

async function client(proposalId: string): Promise<Socket> {
  const s = connect(url, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((resolve) => s.on("connect", () => resolve()));
  s.emit("subscribe", { proposalId });
  await new Promise((r) => setTimeout(r, 50)); // let the join land
  return s;
}

const progress: PipelineProgress = { proposalId: "MIP-21", step: "simulate", status: "completed", ms: 2140 };

describe("Socket.IO", () => {
  it("delivers events to the proposal's room and to proposal:*, not to other rooms", async () => {
    const [mine, all, other] = await Promise.all([client("MIP-21"), client("*"), client("MIP-12")]);
    const got = { mine: [] as unknown[], all: [] as unknown[], other: [] as unknown[] };
    mine.on("pipeline:progress", (p) => got.mine.push(p));
    all.on("pipeline:progress", (p) => got.all.push(p));
    other.on("pipeline:progress", (p) => got.other.push(p));

    bus.emit("pipeline:progress", progress);
    await new Promise((r) => setTimeout(r, 100));

    expect(got.mine).toEqual([progress]);
    expect(got.all).toEqual([progress]);
    expect(got.other).toEqual([]);
    for (const s of [mine, all, other]) s.disconnect();
  });

  it("sends chain events without a proposal to proposal:* only", async () => {
    const [all, mine] = await Promise.all([client("*"), client("MIP-21")]);
    const got = { all: 0, mine: 0 };
    all.on("chain:event", () => got.all++);
    mine.on("chain:event", () => got.mine++);
    bus.emit("chain:event", { proposalId: null, contract: "MockUSDC", name: "Transfer", args: {}, blockNumber: 3, txHash: "0x01", logIndex: 0 });
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual({ all: 1, mine: 0 });
    all.disconnect();
    mine.disconnect();
  });
});

describe("HTTP extras", () => {
  it("serves the OpenAPI document with every route", async () => {
    const res = await request(http).get("/docs.json").expect(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths).sort()).toEqual(["/health", "/proposals", "/proposals/{id}", "/proposals/{id}/commit", "/proposals/{id}/run", "/proposals/{id}/versions"]);
    expect(res.body.components.schemas.ProposalBundle).toBeDefined();
  });

  it("serves Swagger UI at /docs", async () => {
    const res = await request(http).get("/docs/").expect(200);
    expect(res.text).toMatch(/swagger-ui/i);
  });

  it("allows CORS from the frontend origin only", async () => {
    const ok = await request(http).get("/health").set("Origin", "http://localhost:3000");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const other = await request(http).get("/health").set("Origin", "http://evil.test");
    expect(other.headers["access-control-allow-origin"]).not.toBe("http://evil.test");
  });
});
