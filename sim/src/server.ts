import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pino } from "pino";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { rpcReachable } from "./rpc.js";

// Root .env is optional; real environment variables win.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: "sim" } });

const app = createApp({
  logger,
  mocks: config.USE_MOCKS,
  forkReachable: () => rpcReachable(config.ANVIL_URL),
});

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, anvil: config.ANVIL_URL, mocks: config.USE_MOCKS }, "sim listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
