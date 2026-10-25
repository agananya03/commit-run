import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Network } from "ethers";
import { pino } from "pino";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { ContractBook, loadDeployments } from "./deployments.js";
import { rpcReachable } from "./rpc.js";
import { Simulator } from "./simulate.js";

// Root .env is optional; real environment variables win.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, base: { service: "sim" } });
const { deployments, source } = loadDeployments(config.DEPLOYMENTS_FILE, config.FALLBACK_DEPLOYMENTS_FILE, logger);
const network = Network.from(deployments.chainId);
const provider = (url: string) => {
  const p = new JsonRpcProvider(url, network, { staticNetwork: true });
  p.pollingInterval = 100;
  return p;
};

const simulator = new Simulator({ anvil: provider(config.ANVIL_URL), source: provider(config.RPC_URL), rpcUrl: config.RPC_URL, book: new ContractBook(deployments), logger });
const app = createApp({ logger, forkReachable: () => rpcReachable(config.ANVIL_URL), simulator });

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, anvil: config.ANVIL_URL, rpc: config.RPC_URL, deployments: source }, "sim listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
