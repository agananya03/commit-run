import cors from "cors";
import express, { type Express } from "express";
import type { Logger } from "pino";
import swaggerUi from "swagger-ui-express";
import type { Health } from "../../shared/schemas/types.js";
import { errorHandler, unknownRoute } from "./errors.js";
import { buildOpenApiDocument } from "./openapi.js";
import type { ProposalService } from "./proposals/service.js";
import { proposalRoutes } from "./routes/proposals.js";

export interface AppDeps {
  logger: Logger;
  mocks: boolean;
  /** Dependency name -> probe. postgres now; redis, rpc, rag, sim are added as they land. */
  checks: Record<string, () => Promise<boolean>>;
  corsOrigin?: string;
  proposals?: ProposalService;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: deps.corsOrigin ?? "http://localhost:3000" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", async (_req, res) => {
    const names = Object.keys(deps.checks);
    const results = await Promise.all(names.map((name) => deps.checks[name]?.() ?? Promise.resolve(false)));
    const depStates: Health["deps"] = {};
    names.forEach((name, i) => {
      depStates[name] = results[i] ? "ok" : "down";
    });
    const body: Health = {
      service: "backend",
      status: results.every(Boolean) ? "ok" : "degraded",
      mocks: deps.mocks,
      deps: depStates,
    };
    res.json(body);
  });

  const openapi = buildOpenApiDocument();
  app.get("/docs.json", (_req, res) => {
    res.json(openapi);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));

  if (deps.proposals) app.use(proposalRoutes(deps.proposals));

  app.use(unknownRoute);
  app.use(errorHandler(deps.logger));
  return app;
}
