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
  pool: "0x17546d9d321F50B570e09014008E2187d3bf58a0",
  engine: "0xB388c83F2fFc8251C3F6340616600B9f83976cE7",
  vault: "0xC540214A657d8D7CE20a6E3A4966CA0fFf2D571d",
  ledger: "0x8caB02ad0Bfc5016CccFf3f844F304F094ccF767",
  disclosure: "0xd98db1581FF1d82f65f8b53DA517Ea3438233416",
  token: "0xc5f14c03f5de8eB4687279079a9136DcFA323115",
  policy: "0x2024292b6dD5C5374Fe921287cBa3F9911e88B20",
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
