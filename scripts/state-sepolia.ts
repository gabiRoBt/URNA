import { ethers } from "hardhat";

import deployment from "../deployments/11155111.json";
import type {
  ConfidentialPrizePool,
  DrawEngine,
  PrizeVault,
  TicketLedger,
  TieredWeightPolicy,
} from "../types";

/**
 * What the live deployment currently holds.
 *
 * Read-only and free. Every other script here spends gas, which makes it
 * awkward to answer the one question you ask most often: what state is the
 * pool actually in right now. This answers it without touching anything.
 *
 *   npx.cmd hardhat run scripts/state-sepolia.ts --network sepolia
 */

const STATE = ["Open", "Sealed", "Selecting", "Settled"] as const;

async function main(): Promise<void> {
  const [signer] = await ethers.getSigners();
  if (signer === undefined) throw new Error("no signer configured");

  const at = async <T>(name: string, address: string): Promise<T> =>
    (await ethers.getContractAt(name, address, signer)) as unknown as T;

  const policy = await at<TieredWeightPolicy>("TieredWeightPolicy", deployment.policy);
  const ledger = await at<TicketLedger>("TicketLedger", deployment.ledger);
  const vault = await at<PrizeVault>("PrizeVault", deployment.vault);
  const engine = await at<DrawEngine>("DrawEngine", deployment.engine);
  const pool = await at<ConfidentialPrizePool>("ConfidentialPrizePool", deployment.pool);

  const line = (label: string, value: unknown): void => {
    process.stdout.write(`  ${label.padEnd(22)} ${String(value)}\n`);
  };

  const balance = await ethers.provider.getBalance(signer.address);
  const drawId = await engine.currentDrawId();

  process.stdout.write("\n");
  line("Operator", signer.address);
  line("Operator ETH", `${ethers.formatEther(balance)} ETH`);

  process.stdout.write("\n");
  line("Participants", await ledger.participantCount());
  line("Published principal", await pool.publishedPrincipal());
  line("Unallocated prize", await vault.unallocatedPrize());
  line("Tier threshold", (await policy.thresholdHandle()) === ethers.ZeroHash ? "not set" : "set");
  line("Tiers", await engine.tierCount());
  line("Max slice", await engine.maxSlice());

  process.stdout.write("\n");
  if (drawId === 0n) {
    line("Draw", "none yet");
  } else {
    const facts = await engine.drawFacts(drawId);
    line("Draw", drawId);
    line("State", STATE[Number(facts[0])] ?? facts[0]);
    line("Sealed positions", facts[3]);
    line("Total weight", facts[1]);
    line("Prize", facts[2]);
    line("Cursor", `tier ${facts[4]}, index ${facts[5]}`);
    line("Ledger frozen at", await ledger.frozenDrawId());
  }
  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
