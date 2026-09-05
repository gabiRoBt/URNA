import { ethers, fhevm } from "hardhat";

import { SEPOLIA } from "../frontend/lib/config";
import type {
  ConfidentialPrizePool,
  ConfidentialTokenMock,
  TieredWeightPolicy,
} from "../types";

/**
 * Proves the confidential path works against the real coprocessors.
 *
 * Everything the test suite establishes was measured in mock mode, where the
 * FHE calls are simulated. This script exercises the parts that only a real
 * deployment can answer: does the relayer accept an encrypted input, does the
 * coprocessor perform the homomorphic work inside the gas a transaction can
 * pay for, and does user decryption round-trip.
 *
 * It stops short of a draw. Confirming deposits work is the prerequisite, and
 * it is worth confirming on its own before spending time on the rest.
 *
 *   npx.cmd hardhat run scripts/smoke-sepolia.ts --network sepolia
 */

const THRESHOLD = 500_000n;
const DEPOSIT = 1_000_000n;

async function main(): Promise<void> {
  // `hardhat test` sets the plugin up on its own; `hardhat run` does not, and
  // the failure it produces names the plugin rather than the missing call.
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  if (signer === undefined) throw new Error("no signer configured");

  process.stdout.write(`\n  Acting as ${signer.address}\n\n`);

  const token = (await ethers.getContractAt(
    "ConfidentialTokenMock",
    SEPOLIA.token,
    signer,
  )) as unknown as ConfidentialTokenMock;

  const pool = (await ethers.getContractAt(
    "ConfidentialPrizePool",
    SEPOLIA.pool,
    signer,
  )) as unknown as ConfidentialPrizePool;

  const policy = (await ethers.getContractAt(
    "TieredWeightPolicy",
    SEPOLIA.policy,
    signer,
  )) as unknown as TieredWeightPolicy;

  // ── 1. Threshold ────────────────────────────────────────────────────────
  //
  // The tier boundary is a ciphertext, so it cannot come from the deploy
  // script. Without it the weight policy reverts and no deposit can settle.

  const thresholdHandle = await policy.thresholdHandle();
  if (thresholdHandle === ethers.ZeroHash) {
    process.stdout.write("  Setting the tier threshold...\n");
    const encrypted = await fhevm
      .createEncryptedInput(SEPOLIA.policy, signer.address)
      .add64(THRESHOLD)
      .encrypt();

    const tx = await policy.setThreshold(encrypted.handles[0]!, encrypted.inputProof);
    await tx.wait();
    process.stdout.write(`    done, ${tx.hash}\n`);
  } else {
    process.stdout.write("  Threshold already set.\n");
  }

  // ── 2. Mint and authorise ───────────────────────────────────────────────

  process.stdout.write("  Minting test tokens...\n");
  await (await token.mint(signer.address, DEPOSIT * 4n)).wait();

  const until = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  process.stdout.write("  Authorising the pool as operator...\n");
  await (await token.setOperator(SEPOLIA.pool, until)).wait();

  // ── 3. Deposit ──────────────────────────────────────────────────────────
  //
  // The real test: an encrypted input, verified by the relayer, consumed by a
  // confidential transfer, then weighed homomorphically by the tier policy —
  // all inside one transaction's gas budget.

  process.stdout.write("  Depositing...\n");
  const input = await fhevm
    .createEncryptedInput(SEPOLIA.pool, signer.address)
    .add64(DEPOSIT)
    .encrypt();

  const depositTx = await pool.deposit(input.handles[0]!, input.inputProof);
  const receipt = await depositTx.wait();
  process.stdout.write(
    `    done, ${depositTx.hash}\n` + `    gas used ${receipt?.gasUsed.toLocaleString()}\n`,
  );

  // ── 4. Read it back ─────────────────────────────────────────────────────

  process.stdout.write("  Decrypting the balance...\n");
  const balanceHandle = await pool.balanceOf(signer.address);

  if (balanceHandle === ethers.ZeroHash) {
    throw new Error("deposit settled but the balance handle is empty");
  }

  const balance = await fhevm.userDecryptEuint(
    0x05 as never, // euint64
    balanceHandle,
    SEPOLIA.pool,
    signer,
  );

  process.stdout.write(`    balance reads ${balance}\n\n`);

  if (balance !== DEPOSIT) {
    throw new Error(`expected ${DEPOSIT}, decrypted ${balance}`);
  }

  process.stdout.write("  Confidential deposit works on Sepolia.\n\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
