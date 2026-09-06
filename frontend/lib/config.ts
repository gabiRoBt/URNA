/**
 * Deployment addresses and network settings.
 *
 * Filled from the output of `scripts/deploy.ts`. Kept as a plain module rather
 * than environment variables so a reader can see at a glance which deployment
 * the interface is pointed at.
 */

export interface Deployment {
  readonly chainId: number;
  readonly chainName: string;
  readonly explorer: string;
  readonly pool: `0x${string}`;
  readonly engine: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly ledger: `0x${string}`;
  readonly disclosure: `0x${string}`;
  readonly token: `0x${string}`;
  readonly policy: `0x${string}`;
}

const UNSET = "0x0000000000000000000000000000000000000000" as const;

export const SEPOLIA: Deployment = {
  chainId: 11155111,
  chainName: "Sepolia",
  explorer: "https://sepolia.etherscan.io",
  pool: "0x13e56453dd53281C94532c1fdaa14FD70313BD1c",
  engine: "0xd581DFc00b87ab6187BBCA87928087658E1f7b6F",
  vault: "0x560a172d9105e907309a1463E1d17F0F68B8f54c",
  ledger: "0x4ab0e0D2410c3a47778f473035204777F30d1E0A",
  disclosure: "0x5882825a14012Ff157545bed0355ac7aC021d087",
  token: "0xbdb5E117ccEE3AfEbCde8c95AD03f10B114DAD6E",
  policy: "0x8fe805c98e37cFbB64F3640801bcff323C104556",
};

export const deployment = SEPOLIA;

/**
 * Where the interface reads from when no wallet is connected.
 *
 * The pool's total, the number of positions and the state of a draw are
 * public by design. Requiring a wallet before showing them made the page look
 * empty to anyone who merely opened it — a confidential pool that appears to
 * hold nothing argues against itself.
 *
 * Deliberately outside the block above: `scripts/deploy.ts` rewrites that one
 * wholesale, so anything added to it disappears at the next deployment.
 */
export const RPC_URL =
  process.env["NEXT_PUBLIC_RPC_URL"] ?? "https://ethereum-sepolia-rpc.publicnode.com";

/** Whether the interface has been pointed at a real deployment yet. */
export const isDeployed = deployment.pool !== UNSET;

/** Decimals the confidential token reports. */
export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "cUSD";
