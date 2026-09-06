import { ethers, fhevm } from "hardhat";
import type { Wallet } from "ethers";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import deployment from "../deployments/11155111.json";
import seed from "../deployments/11155111-seed.json";
import type { ConfidentialTokenMock, PrizeVault } from "../types";

/**
 * Proves, against the live chain, that claiming actually moves money.
 *
 * The unit tests establish this in mock mode. They cannot establish it where
 * the coprocessors are real, the relayer is in the loop and the token is a
 * separate deployment — which is the only place the claim has ever had to
 * work. So this claims a seeded winner's award and reads their own token
 * balance either side of it.
 *
 * Read-only in the sense that matters: the award was already theirs, and
 * claiming is what any winner does in the app.
 *
 *   npx.cmd hardhat run scripts/verify-payout.ts --network sepolia
 */

const EUINT64 = 0x05 as never;

async function main(): Promise<void> {
  await fhevm.initializeCLIApi();

  const [operator] = await ethers.getSigners();
  if (operator === undefined) throw new Error("no signer configured");

  const secret = (process.env["DEPLOYER_PRIVATE_KEY"] ?? "").trim();
  if (secret === "") throw new Error("DEPLOYER_PRIVATE_KEY is not set");

  const winner = seed.winners[0];
  if (winner === undefined) throw new Error("the seed record names no winner");

  // The seeded accounts are derived rather than stored, so the one that won
  // is found by rederiving the same list and matching on address.
  let account: Wallet | undefined;
  for (let index = 0; index < 32; index += 1) {
    const material = ethers.keccak256(
      ethers.solidityPacked(["string", "string", "uint256"], [secret, "urna/seed", index]),
    );
    const candidate = new ethers.Wallet(material, ethers.provider);
    if (candidate.address.toLowerCase() === winner.address.toLowerCase()) {
      account = candidate;
      break;
    }
  }
  if (account === undefined) throw new Error(`could not derive ${winner.address}`);

  const at = async <T>(name: string, address: string): Promise<T> =>
    (await ethers.getContractAt(name, address, account)) as unknown as T;

  const token = await at<ConfidentialTokenMock>("ConfidentialTokenMock", deployment.token);
  const vault = await at<PrizeVault>("PrizeVault", deployment.vault);

  const say = (text: string): void => {
    process.stdout.write(`  ${text}\n`);
  };

  const balance = async (): Promise<bigint> => {
    const handle = await token.confidentialBalanceOf(account!.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(EUINT64, handle, deployment.token, account!);
  };

  process.stdout.write("\n");
  say(`winner   ${account.address}`);
  say(`draw     ${seed.drawId}`);
  say(`award    ${winner.award}`);

  if (await vault.hasClaimed(BigInt(seed.drawId), account.address)) {
    say("already claimed; nothing left to prove here");
    return;
  }

  // The account needs gas of its own. It was swept clean after depositing.
  const fee = await ethers.provider.getFeeData();
  const cap = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const held = await ethers.provider.getBalance(account.address);
  // Sized against the fee cap, and generous: claiming now performs a
  // confidential transfer, so its gas estimate is a long way above what a
  // bookkeeping call used to cost.
  const needed = cap * 1_200_000n;
  if (held < needed) {
    say("funding the winner for gas");
    await (
      await operator.sendTransaction({ to: account.address, value: needed - held })
    ).wait();
  }

  const before = await balance();
  say(`balance  ${before} before claiming`);

  const receipt = await (await vault.claim(BigInt(seed.drawId))).wait();
  say(`claimed  ${receipt?.gasUsed.toLocaleString()} gas, tx ${receipt?.hash}`);

  const after = await balance();
  say(`balance  ${after} after`);

  const moved = after - before;
  if (moved !== BigInt(winner.award)) {
    throw new Error(`expected ${winner.award} to move, saw ${moved}`);
  }

  say(`\n  ${moved} moved, exactly the award. The prize is money, not a number.\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
