import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

// Default Hardhat mnemonic: addresses are deterministic, so /data/wallets.json can refer to accounts by index.
// count = 80 because the wallet universe uses Hardhat accounts 0..79.
const accounts = {
  mnemonic: "test test test test test test test test test test test junk",
  count: 80,
};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts,
      blockGasLimit: 30_000_000,
      // Start the chain clock earlier so seeded transfers can carry historic timestamps.
      ...(process.env.CHAIN_START_DATE ? { initialDate: process.env.CHAIN_START_DATE } : {}),
    },
    localhost: {
      url: process.env.RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 31337,
      accounts,
    },
    // Anvil fork used by /sim (npm run fork)
    anvil: {
      url: process.env.ANVIL_URL ?? "http://127.0.0.1:8546",
      chainId: 31337,
      accounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    offline: true,
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
