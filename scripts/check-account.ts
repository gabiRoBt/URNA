import { ethers } from "hardhat";

/**
 * Reports which account will deploy, and whether it can afford to.
 *
 * The failure this exists to diagnose is asking a faucet to fund one address
 * while Hardhat signs with another — easy to do when a wallet extension and a
 * generated key are both in play, and invisible from the error, which only
 * says the balance is zero.
 *
 *   npx.cmd hardhat run scripts/check-account.ts --network sepolia
 */

/** Rough cost of a full deploy: 10.4M gas, measured locally. */
const DEPLOY_GAS = 10_412_466n;

async function main(): Promise<void> {
  const network = await ethers.provider.getNetwork();
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  process.stdout.write(`\n  Network      ${network.name} (chain ${network.chainId})\n`);

  if (deployer === undefined) {
    process.stdout.write(
      `\n  No signer configured.\n\n` +
        `  DEPLOYER_PRIVATE_KEY is missing or empty. Check that .env sits in\n` +
        `  the project root next to package.json, not in frontend/.\n\n`,
    );
    process.exitCode = 1;
    return;
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  const feeData = await ethers.provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  const estimate = DEPLOY_GAS * gasPrice;

  process.stdout.write(
    `  Deployer     ${deployer.address}\n` +
      `  Balance      ${ethers.formatEther(balance)} ETH\n` +
      `  Gas price    ${ethers.formatUnits(gasPrice, "gwei")} gwei\n` +
      `  Deploy costs ${ethers.formatEther(estimate)} ETH (approx)\n\n`,
  );

  if (balance === 0n) {
    process.stdout.write(
      `  This account has nothing. Send it testnet ETH at the address above —\n` +
        `  and check it is the same address you gave the faucet.\n\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (balance < estimate) {
    process.stdout.write(`  Not enough to cover the deploy. Top it up and retry.\n\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`  Ready to deploy.\n\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
