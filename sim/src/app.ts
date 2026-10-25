import express, { type Express } from "express";
import type { Logger } from "pino";
import type { Health } from "../../shared/schemas/types.js";

export interface AppDeps {
  logger: Logger;
  mocks: boolean;
  /** Probes the Anvil fork; injected so tests don't need a running node. */
  forkReachable: () => Promise<boolean>;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    const fork = await deps.forkReachable();
    const body: Health = {
      service: "sim",
      status: fork ? "ok" : "degraded",
      mocks: deps.mocks,
      deps: { fork: fork ? "ok" : "down" },
    };
    res.json(body);
  });

  return app;
}
