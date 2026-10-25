import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RagClient } from "../src/clients/ragClient.js";
import { SimClient } from "../src/clients/simClient.js";
import { HttpError } from "../src/errors.js";

const mocksDir = fileURLToPath(new URL("../../shared/mocks", import.meta.url));
const summaryMock: unknown = JSON.parse(readFileSync(`${mocksDir}/summarize.MIP-21.json`, "utf8"));

// A fake rag service whose behaviour each test chooses.
let mode: "ok" | "invalid" | "notFound" | "unavailable" | "boom" = "ok";
let fakeRag: Server;
let ragUrl = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post("/summarize", (_req, res) => {
    if (mode === "ok") res.json(summaryMock);
    else if (mode === "invalid") res.json({ ...(summaryMock as object), surprise: true });
    else if (mode === "notFound") res.status(404).json({ error: { code: "NOT_FOUND", message: "not ingested" } });
    else if (mode === "unavailable") res.status(503).send("busy");
    else res.status(500).send("stack trace");
  });
  await new Promise<void>((resolve) => {
    fakeRag = app.listen(0, () => resolve());
  });
  ragUrl = `http://127.0.0.1:${(fakeRag.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => fakeRag.close(() => resolve())));

const logger = { warn: vi.fn(), debug: vi.fn() };
beforeEach(() => {
  logger.warn.mockClear();
  mode = "ok";
});

const rag = (baseURL: string, useMocks = false) => new RagClient({ baseURL, timeoutMs: 2000, useMocks, mocksDir, logger });
const DOWN = "http://127.0.0.1:1"; // nothing listens here

const expectHttpError = async (p: Promise<unknown>, status: number, code: string) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(HttpError);
  expect(err).toMatchObject({ status, code });
};

describe("RagClient", () => {
  it("returns a validated response from the real service", async () => {
    const s = await rag(ragUrl).summarize({ proposalId: "MIP-21" });
    expect(s.proposalId).toBe("MIP-21");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("rejects a response that breaks the shared schema (502 UPSTREAM_INVALID, no silent fallback)", async () => {
    mode = "invalid";
    await expectHttpError(rag(ragUrl).summarize({ proposalId: "MIP-21" }), 502, "UPSTREAM_INVALID");
  });

  it("passes an upstream ApiError through with its status", async () => {
    mode = "notFound";
    await expectHttpError(rag(ragUrl).summarize({ proposalId: "MIP-21" }), 404, "NOT_FOUND");
  });

  it("reports a 500 without an ApiError body as UPSTREAM_INVALID", async () => {
    mode = "boom";
    await expectHttpError(rag(ragUrl).summarize({ proposalId: "MIP-21" }), 502, "UPSTREAM_INVALID");
  });

  it("falls back to the mock with a warning when the service is down", async () => {
    const s = await rag(DOWN).summarize({ proposalId: "MIP-21" });
    expect(s).toEqual(summaryMock);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(String(logger.warn.mock.calls[0]?.[1])).toMatch(/falling back to mock/);
  });

  it("treats 503 as down and falls back", async () => {
    mode = "unavailable";
    await expect(rag(ragUrl).summarize({ proposalId: "MIP-21" })).resolves.toEqual(summaryMock);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("serves mocks without calling the service when USE_MOCKS=true", async () => {
    mode = "invalid"; // would fail if called
    await expect(rag(ragUrl, true).summarize({ proposalId: "MIP-21" })).resolves.toEqual(summaryMock);
  });

  it("is 502 UPSTREAM_UNAVAILABLE when down and there is no mock for that proposal", async () => {
    await expectHttpError(rag(DOWN).summarize({ proposalId: "MIP-404" }), 502, "UPSTREAM_UNAVAILABLE");
  });

  it("derives search results and single chunks from the ingest mock", async () => {
    const client = rag(DOWN, true);
    const hits = await client.search({ proposalId: "MIP-21", query: "ownership timelock", k: 2 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0]?.text.toLowerCase()).toMatch(/ownership|timelock/);
    expect((await client.getChunk("MIP-21:pdf:0")).id).toBe("MIP-21:pdf:0");
  });
});

describe("SimClient", () => {
  it("serves validated simulate and deployments mocks", async () => {
    const sim = new SimClient({ baseURL: DOWN, timeoutMs: 1000, useMocks: true, mocksDir, logger });
    const result = await sim.simulate({ proposalId: "MIP-21", targets: [], values: [], calldatas: [] });
    expect(result.ownershipChanges[0]?.role).toBe("owner");
    expect((await sim.deployments()).chainId).toBe(31337);
  });

  it("cannot fake a chain reset", async () => {
    const sim = new SimClient({ baseURL: DOWN, timeoutMs: 1000, useMocks: false, mocksDir, logger });
    await expectHttpError(sim.reset(), 502, "UPSTREAM_UNAVAILABLE");
  });
});
