import { ethers, fhevm } from "hardhat";

import deployment from "../deployments/11155111.json";
import type {
  ConfidentialPrizePool,
  ConfidentialTokenMock,
  DrawEngine,
  PrizeVault,
  TicketLedger,
  TieredWeightPolicy,
} from "../types";

/**
 * The full cycle against the live deployment.
 *
 * Deposit, seal, draw, claim, withdraw — every step on Sepolia, against the
 * real coprocessors. This is the run that answers the questions the mock
 * cannot: whether a selection slice fits in a block, whether the relayer
 * round-trips a public decryption, and whether an award ends up readable by
 * the account that won it.
 *
 *   npx.cmd hardhat run scripts/e2e-sepolia.ts --network sepolia
 */

const THRESHOLD = 5_000n * 10n ** 6n;
const DEPOSIT = 1_000n * 10n ** 6n;
const PRIZE = 250n * 10n ** 6n;

const EUINT64 = 0x05 as never;

async function main(): Promise<void> {
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  if (signer === undefined) throw new Error("no signer configured");

  const at = async <T>(name: string, address: string): Promise<T> =>
    (await ethers.getContractAt(name, address, signer)) as unknown as T;

  const token = await at<ConfidentialTokenMock>("ConfidentialTokenMock", deployment.token);
  const policy = await at<TieredWeightPolicy>("TieredWeightPolicy", deployment.policy);
  const ledger = await at<TicketLedger>("TicketLedger", deployment.ledger);
  const vault = await at<PrizeVault>("PrizeVault", deployment.vault);
  const engine = await at<DrawEngine>("DrawEngine", deployment.engine);
  const pool = await at<ConfidentialPrizePool>("ConfidentialPrizePool", deployment.pool);

  const step = (text: string): void => {
    process.stdout.write(`\n  ${text}\n`);
  };
  const detail = (text: string): void => {
    process.stdout.write(`    ${text}\n`);
  };

  process.stdout.write(`\n  Acting as ${signer.address}\n`);

  // ── Threshold ───────────────────────────────────────────────────────────

  if ((await policy.thresholdHandle()) === ethers.ZeroHash) {
    step("Setting the confidential tier threshold");
    const encrypted = await fhevm
      .createEncryptedInput(deployment.policy, signer.address)
      .add64(THRESHOLD)
      .encrypt();
    await (await policy.setThreshold(encrypted.handles[0]!, encrypted.inputProof)).wait();
    detail("done");
  }

  // ── Deposit ─────────────────────────────────────────────────────────────

  step("Minting and depositing");
  await (await token.mint(signer.address, DEPOSIT * 4n)).wait();
  await (
    await token.setOperator(deployment.pool, Math.floor(Date.now() / 1000) + 86_400)
  ).wait();

  const input = await fhevm
    .createEncryptedInput(deployment.pool, signer.address)
    .add64(DEPOSIT)
    .encrypt();
  const depositTx = await pool.deposit(input.handles[0]!, input.inputProof);
  const depositReceipt = await depositTx.wait();
  detail(`deposited, ${depositReceipt?.gasUsed.toLocaleString()} gas`);

  const balance = await fhevm.userDecryptEuint(
    EUINT64,
    await pool.balanceOf(signer.address),
    deployment.pool,
    signer,
  );
  detail(`balance decrypts to ${balance}`);
  if (balance !== DEPOSIT) throw new Error(`expected ${DEPOSIT}, got ${balance}`);

  // ── Prize ───────────────────────────────────────────────────────────────

  step("Funding the prize reserve");
  await (await vault.fundPrize(PRIZE)).wait();
  detail(`reserve now ${await vault.unallocatedPrize()}`);

  // ── Seal ────────────────────────────────────────────────────────────────

  step("Sealing the draw");
  await (await engine.seal()).wait();
  const drawId = await engine.currentDrawId();
  detail(`draw ${drawId}, ${await ledger.sealedCount(drawId)} positions`);

  step("Publishing total weight");
  const totalHandle = await ledger.sealedTotalWeight(drawId);
  const published = await fhevm.publicDecrypt([totalHandle]);
  const clearValues = published.clearValues as Record<string, string | number | bigint>;
  const key = Object.keys(clearValues).find(
    (candidate) => candidate.toLowerCase() === totalHandle.toLowerCase(),
  );
  if (key === undefined) throw new Error("relayer returned no total weight");

  const totalWeight = BigInt(clearValues[key]!);
  await (
    await engine.publishTotalWeight(drawId, totalWeight, published.decryptionProof)
  ).wait();
  detail(`total weight ${totalWeight}`);

  // ── Draw ────────────────────────────────────────────────────────────────

  step("Opening the draw");
  await (await engine.open(drawId)).wait();
  detail("prize locked, draw point generated encrypted");

  step("Walking the selection");
  let slices = 0;
  while ((await engine.stateOf(drawId)) !== 3n) {
    const tx = await engine.advance(drawId, 10);
    const receipt = await tx.wait();
    slices += 1;
    detail(`slice ${slices}: ${receipt?.gasUsed.toLocaleString()} gas`);
    if (slices > 40) throw new Error("draw did not converge");
  }
  detail(`settled in ${slices} transactions`);

  // ── Claim ───────────────────────────────────────────────────────────────

  step("Reading the award");
  const awardHandle = await vault.awardOf(drawId, signer.address);
  const award = await fhevm.userDecryptEuint(EUINT64, awardHandle, deployment.vault, signer);
  detail(`award decrypts to ${award}`);

  if (award > 0n) {
    await (await vault.claim(drawId)).wait();
    detail("claimed");
  }

  // ── Withdraw ────────────────────────────────────────────────────────────

  step("Withdrawing principal");
  const exit = await fhevm
    .createEncryptedInput(deployment.pool, signer.address)
    .add64(DEPOSIT)
    .encrypt();
  await (await pool.withdraw(exit.handles[0]!, exit.inputProof)).wait();

  const remaining = await fhevm.userDecryptEuint(
    EUINT64,
    await pool.balanceOf(signer.address),
    deployment.pool,
    signer,
  );
  detail(`balance now ${remaining}`);
  if (remaining !== 0n) throw new Error(`expected 0 after full exit, got ${remaining}`);

  process.stdout.write("\n  Full cycle works on Sepolia.\n\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
