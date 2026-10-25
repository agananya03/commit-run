import { createServer } from "node:http";
import { pino } from "pino";
import { createApp } from "./app.js";
import { RagClient } from "./clients/ragClient.js";
import { SimClient } from "./clients/simClient.js";
import { createDb, dbReachable } from "./db.js";
import { loadEnv } from "./env.js";
import { attachSocket } from "./events.js";
import { loadRootEnv, repoRoot } from "./loadRootEnv.js";
import { ProposalService } from "./proposals/service.js";

loadRootEnv();
const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "backend" } });
const db = createDb(env.DATABASE_URL);

const upstream = { timeoutMs: env.UPSTREAM_TIMEOUT_MS, useMocks: env.USE_MOCKS, mocksDir: env.MOCKS_DIR, logger };
export const rag = new RagClient({ ...upstream, baseURL: env.RAG_URL });
export const sim = new SimClient({ ...upstream, baseURL: env.SIM_URL });

const app = createApp({
  logger,
  mocks: env.USE_MOCKS,
  checks: { postgres: () => dbReachable(db) },
  corsOrigin: env.CORS_ORIGIN,
  proposals: new ProposalService({ db, dataDir: env.DATA_DIR, uploadDir: env.UPLOAD_DIR, repoRoot }),
});

const httpServer = createServer(app);
export const { io, bus } = attachSocket(httpServer, env.CORS_ORIGIN, logger);

httpServer.listen(env.PORT, () => {
  logger.info({ port: env.PORT, mocks: env.USE_MOCKS, rag: env.RAG_URL, sim: env.SIM_URL }, "backend listening (HTTP + Socket.IO)");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    void io.close();
    httpServer.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    });
  });
}
