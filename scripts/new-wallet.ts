import { Wallet } from "ethers";

/**
 * Generates a throwaway deployment key.
 *
 * Exporting a key out of a wallet extension means hunting through a UI that
 * changes between releases, and it encourages reusing a key that also holds
 * something. Generating a fresh one takes a second and is strictly safer: this
 * account exists only to deploy to a testnet, and nothing of value ever
 * touches it.
 *
 *   npx hardhat run scripts/new-wallet.ts
 */

function main(): void {
  const wallet = Wallet.createRandom();

  process.stdout.write(
    `\n  Address      ${wallet.address}\n` +
      `  Private key  ${wallet.privateKey}\n` +
      `\n  Put the private key in .env as DEPLOYER_PRIVATE_KEY,\n` +
      `  and send this address testnet ETH from a faucet.\n` +
      `\n  Testnet only. Never send real funds to this address, and do not\n` +
      `  reuse this key anywhere else — it was printed to a terminal and is\n` +
      `  about to sit in a file in plaintext.\n\n`,
  );
}

main();
