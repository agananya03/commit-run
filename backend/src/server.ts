import { createServer } from "node:http";
import { Redis } from "ioredis";
import { pino } from "pino";
import { createApp } from "./app.js";
import { createChain } from "./chain/index.js";
import { ChainListener } from "./chain/listener.js";
import { RagClient } from "./clients/ragClient.js";
import { SimClient } from "./clients/simClient.js";
import { createDb, dbReachable } from "./db.js";
import { loadEnv } from "./env.js";
import { attachSocket } from "./events.js";
import { loadRootEnv, repoRoot } from "./loadRootEnv.js";
import { Pipeline } from "./pipeline/pipeline.js";
import { ProposalService } from "./proposals/service.js";

loadRootEnv();
const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: "backend" } });
const db = createDb(env.DATABASE_URL);

const upstream = { timeoutMs: env.UPSTREAM_TIMEOUT_MS, useMocks: env.USE_MOCKS, mocksDir: env.MOCKS_DIR, logger };
const rag = new RagClient({ ...upstream, baseURL: env.RAG_URL });
const sim = new SimClient({ ...upstream, baseURL: env.SIM_URL });
const chain = createChain(env, logger);
const proposals = new ProposalService({ db, dataDir: env.DATA_DIR, uploadDir: env.UPLOAD_DIR, repoRoot, registry: chain.registry });

// The HTTP server exists first so Socket.IO (the pipeline's event bus) can attach before the app is built.
const httpServer = createServer();
const { io, bus } = attachSocket(httpServer, env.CORS_ORIGIN, logger);
const pipeline = new Pipeline({ redisUrl: env.REDIS_URL, db, deps: { db, rag, sim, proposals, deployments: chain.deployments }, bus, logger });

const redisProbe = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const app = createApp({
  logger,
  mocks: env.USE_MOCKS,
  checks: {
    postgres: () => dbReachable(db),
    redis: () => redisProbe.ping().then(() => true, () => false),
    rpc: chain.reachable,
  },
  corsOrigin: env.CORS_ORIGIN,
  proposals,
  pipeline,
});
httpServer.on("request", app);

// Backfills ChainEvent + Transfer from block 0, then polls; keeps retrying quietly while the node is down.
const listener = new ChainListener({ db, provider: chain.provider, deployments: chain.deployments, bus, logger });

httpServer.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, mocks: env.USE_MOCKS, rag: env.RAG_URL, sim: env.SIM_URL, rpc: env.RPC_URL, deployments: chain.deploymentsSource },
    "backend listening (HTTP + Socket.IO, pipeline worker running)",
  );
  listener.start();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    listener.stop();
    void io.close();
    httpServer.close(() => {
      void Promise.allSettled([pipeline.close(), redisProbe.quit(), db.$disconnect()]).finally(() => process.exit(0));
    });
  });
}
