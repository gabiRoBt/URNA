import { promises as fs } from "node:fs";
import path from "node:path";

import { ethers } from "hardhat";
import type { ContractTransactionResponse } from "ethers";

import type {
  ConfidentialPrizePool,
  ConfidentialTokenMock,
  DisclosureRegistry,
  DrawEngine,
  FheRandomEntropy,
  LinearWeightPolicy,
  PrizeVault,
  SimulatedYieldSource,
  TicketLedger,
  TieredWeightPolicy,
} from "../types";

/**
 * Deploys the protocol and closes the wiring cycle.
 *
 * The contracts reference each other in a loop that construction cannot
 * resolve: the ledger needs the pool and the engine, the engine needs the
 * vault, the vault needs the registry. Each exposes a one-time `wire` call
 * instead, and the order below is the only valid one.
 *
 *   npx hardhat run scripts/deploy.ts --network sepolia
 */

/** Prize split across tiers, in basis points. Must not exceed 10,000. */
const TIER_SHARES_BPS = [5_000, 3_000, 2_000];

/** Modelled annual yield, in basis points. */
const APY_BPS = 500;

/**
 * Right-shift forming the tier bonus: shift 1 gives qualifying positions 1.5x
 * weight. Set to `undefined` to deploy the linear policy instead.
 */
const BONUS_SHIFT: number | undefined = 1;

/** Gas consumed by everything this script sends, for cost reporting. */
let gasSpent = 0n;

const fmt = (value: bigint): string => value.toLocaleString("en-US");

async function deploy<T>(name: string, ...args: unknown[]): Promise<T> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  const receipt = await contract.deploymentTransaction()?.wait();
  gasSpent += receipt?.gasUsed ?? 0n;

  const address = await contract.getAddress();
  process.stdout.write(
    `  ${name.padEnd(24)} ${address}  ${fmt(receipt?.gasUsed ?? 0n).padStart(9)} gas\n`,
  );
  return contract as unknown as T;
}

/** Sends a transaction and folds its gas into the running total. */
async function send(
  label: string,
  call: Promise<ContractTransactionResponse>,
): Promise<void> {
  const receipt = await (await call).wait();
  gasSpent += receipt?.gasUsed ?? 0n;
  process.stdout.write(`  ${label.padEnd(24)} ${fmt(receipt?.gasUsed ?? 0n).padStart(9)} gas\n`);
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (deployer === undefined) throw new Error("no signer available");

  const network = await ethers.provider.getNetwork();
  process.stdout.write(
    `\nDeploying Sortis to chain ${network.chainId} as ${deployer.address}\n\n`,
  );

  const token = await deploy<ConfidentialTokenMock>(
    "ConfidentialTokenMock",
    "Confidential USD",
    "cUSD",
  );

  const policy: LinearWeightPolicy | TieredWeightPolicy =
    BONUS_SHIFT === undefined
      ? await deploy<LinearWeightPolicy>("LinearWeightPolicy")
      : await deploy<TieredWeightPolicy>(
          "TieredWeightPolicy",
          deployer.address,
          BONUS_SHIFT,
        );

  const ledger = await deploy<TicketLedger>(
    "TicketLedger",
    deployer.address,
    await policy.getAddress(),
  );
  const yieldSource = await deploy<SimulatedYieldSource>(
    "SimulatedYieldSource",
    deployer.address,
    APY_BPS,
  );
  const disclosure = await deploy<DisclosureRegistry>(
    "DisclosureRegistry",
    deployer.address,
  );

  const vault = await deploy<PrizeVault>(
    "PrizeVault",
    deployer.address,
    await yieldSource.getAddress(),
    await disclosure.getAddress(),
  );

  const entropy = await deploy<FheRandomEntropy>("FheRandomEntropy");

  const engine = await deploy<DrawEngine>(
    "DrawEngine",
    deployer.address,
    await ledger.getAddress(),
    await entropy.getAddress(),
    await vault.getAddress(),
  );

  const pool = await deploy<ConfidentialPrizePool>(
    "ConfidentialPrizePool",
    deployer.address,
    await token.getAddress(),
    await ledger.getAddress(),
    await yieldSource.getAddress(),
  );

  process.stdout.write("\nWiring\n");

  await send("ledger", ledger.wire(await pool.getAddress(), await engine.getAddress()));
  await send("vault", vault.wire(await engine.getAddress()));
  await send("disclosure", disclosure.wire(await vault.getAddress()));
  await send(
    "yieldSource",
    yieldSource.wire(await pool.getAddress(), await vault.getAddress()),
  );
  await send("configureTiers", engine.configureTiers(TIER_SHARES_BPS));

  const gasPrice = (await ethers.provider.getFeeData()).gasPrice ?? 0n;

  process.stdout.write(
    `\nConfiguration\n` +
      `  tiers ${TIER_SHARES_BPS.join(" / ")} bps\n` +
      `  apy   ${APY_BPS} bps\n` +
      `  slice ${await engine.maxSlice()} participants max per advance\n` +
      `\nCost\n` +
      `  ${fmt(gasSpent)} gas total\n` +
      `  ${ethers.formatEther(gasSpent * gasPrice)} ETH at ` +
      `${ethers.formatUnits(gasPrice, "gwei")} gwei\n`,
  );

  if (BONUS_SHIFT !== undefined) {
    process.stdout.write(
      `\nNote: the tier threshold is still unset. It is a ciphertext, so it has\n` +
        `to be supplied through the SDK rather than from a deploy script:\n` +
        `call TieredWeightPolicy.setThreshold with an encrypted value before\n` +
        `the first deposit, or weighing will revert with ThresholdNotSet.\n`,
    );
  }

  // Addresses go to disk, not just to the terminal. A deploy whose output
  // scrolls away, or gets run twice and interleaved, leaves a set of contracts
  // that look deployed and are not wired to each other — a failure that only
  // shows up later, from inside the app.
  const addresses = {
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    token: await token.getAddress(),
    policy: await policy.getAddress(),
    ledger: await ledger.getAddress(),
    yieldSource: await yieldSource.getAddress(),
    disclosure: await disclosure.getAddress(),
    vault: await vault.getAddress(),
    entropy: await entropy.getAddress(),
    engine: await engine.getAddress(),
    pool: await pool.getAddress(),
  };

  const outDir = path.join(__dirname, "..", "deployments");
  await fs.mkdir(outDir, { recursive: true });

  const outFile = path.join(outDir, `${network.chainId}.json`);
  await fs.writeFile(outFile, `${JSON.stringify(addresses, null, 2)}\n`, "utf8");
  process.stdout.write(`\n  Addresses written to deployments/${network.chainId}.json\n`);

  await writeFrontendConfig(addresses);

  process.stdout.write("\nDone.\n\n");
}

/**
 * Rewrites the frontend's address block in place.
 *
 * Copying nine addresses by hand is exactly the kind of step that silently
 * goes wrong, and the failure surfaces as an app that connects but reads
 * nothing.
 */
async function writeFrontendConfig(
  addresses: Record<string, string | number>,
): Promise<void> {
  const configPath = path.join(__dirname, "..", "frontend", "lib", "config.ts");
  const source = await fs.readFile(configPath, "utf8");

  const block =
    `export const SEPOLIA: Deployment = {\n` +
    `  chainId: ${addresses["chainId"]},\n` +
    `  chainName: "Sepolia",\n` +
    `  explorer: "https://sepolia.etherscan.io",\n` +
    `  pool: "${addresses["pool"]}",\n` +
    `  engine: "${addresses["engine"]}",\n` +
    `  vault: "${addresses["vault"]}",\n` +
    `  ledger: "${addresses["ledger"]}",\n` +
    `  disclosure: "${addresses["disclosure"]}",\n` +
    `  token: "${addresses["token"]}",\n` +
    `  policy: "${addresses["policy"]}",\n` +
    `};`;

  const updated = source.replace(
    /export const SEPOLIA: Deployment = \{[\s\S]*?\n\};/,
    block,
  );

  if (updated === source) {
    process.stdout.write(
      `  Could not find the address block in config.ts — update it by hand.\n`,
    );
    return;
  }

  await fs.writeFile(configPath, updated, "utf8");
  process.stdout.write(`  frontend/lib/config.ts updated\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
