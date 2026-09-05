import "dotenv/config";

import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";

import type { HardhatUserConfig } from "hardhat/config";

const SEPOLIA_RPC_URL = process.env["SEPOLIA_RPC_URL"] ?? "";
const DEPLOYER_KEY = normalisePrivateKey(process.env["DEPLOYER_PRIVATE_KEY"] ?? "");

/**
 * Accepts a private key with or without the `0x` prefix.
 *
 * Wallets export it both ways, and ethers rejects the bare form with an error
 * that says nothing about the missing prefix. Normalising here turns a
 * ten-minute confusion into a non-event.
 */
function normalisePrivateKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") return "";
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        // FHE contracts are dominated by external calls into the coprocessor
        // rather than by local arithmetic, so a high run count buys little.
        // Keeping it moderate holds bytecode inside the size limit while the
        // draw engine grows.
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // Matches the chain id ZamaConfig maps to its local coprocessor
      // addresses, so the same contracts run unmodified in mock mode.
      chainId: 31337,
    },
    ...(SEPOLIA_RPC_URL !== ""
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            chainId: 11155111,
            accounts: DEPLOYER_KEY !== "" ? [DEPLOYER_KEY] : [],
          },
        }
      : {}),
  },
  paths: {
    sources: "contracts",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts",
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
  mocha: {
    timeout: 180_000,
  },
};

export default config;
