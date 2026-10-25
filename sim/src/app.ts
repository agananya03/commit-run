import express, { type ErrorRequestHandler, type Express } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import type { Health } from "../../shared/schemas/types.js";
import { SimulateRequest } from "./schema.js";
import type { Simulator } from "./simulate.js";

export interface AppDeps {
  logger: Logger;
  /** Probes the Anvil fork; injected so tests don't need a running node. */
  forkReachable: () => Promise<boolean>;
  simulator?: Simulator;
}

type Code = "VALIDATION_FAILED" | "UPSTREAM_UNAVAILABLE" | "INTERNAL";
const apiError = (code: Code, message: string, details?: unknown) => ({ error: details === undefined ? { code, message } : { code, message, details } });

/** Network-level failures talking to Anvil or the Hardhat node (not reverts, which are part of a result). */
const isRpcDown = (err: unknown): boolean => {
  const e = err as { code?: string; message?: string };
  return e.code === "ECONNREFUSED" || e.code === "NETWORK_ERROR" || e.code === "TIMEOUT" || /ECONNREFUSED|fetch failed|socket hang up/i.test(e.message ?? "");
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    const fork = await deps.forkReachable();
    const body: Health = {
      service: "sim",
      status: fork ? "ok" : "degraded",
      mocks: false, // the sim always simulates for real; the backend falls back to mocks when the sim is down
      deps: { fork: fork ? "ok" : "down" },
    };
    res.json(body);
  });

  app.post("/simulate", async (req, res) => {
    if (!deps.simulator) {
      res.status(502).json(apiError("UPSTREAM_UNAVAILABLE", "Simulator is not configured"));
      return;
    }
    const request = SimulateRequest.parse(req.body);
    res.json(await deps.simulator.simulate(request));
  });

  const onError: ErrorRequestHandler = (err: unknown, req, res, _next) => {
    if (err instanceof ZodError) {
      // A bad request body is the caller's fault; a result failing the schema would be our bug.
      const isRequest = req.path === "/simulate" && !res.headersSent && err.issues.every((i) => i.path.length === 0 || ["proposalId", "targets", "values", "calldatas", "forkBlock"].includes(String(i.path[0])));
      if (isRequest) {
        res.status(400).json(apiError("VALIDATION_FAILED", "Request failed validation", err.issues));
        return;
      }
      deps.logger.error({ issues: err.issues }, "simulation result failed the shared schema");
      res.status(500).json(apiError("INTERNAL", "Simulation result failed the shared schema", err.issues));
    } else if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json(apiError("VALIDATION_FAILED", "Malformed JSON body"));
    } else if (isRpcDown(err)) {
      res.status(502).json(apiError("UPSTREAM_UNAVAILABLE", "Anvil fork or Hardhat node is unreachable; start them with `npm run node` and `npm run fork` in /contracts"));
    } else {
      deps.logger.error({ err }, "simulation failed");
      res.status(500).json(apiError("INTERNAL", (err as Error).message.split("\n")[0] ?? "Internal error"));
    }
  };
  app.use(onError);
  return app;
}
