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
  pool: "0x6787cd0dEa7A2705b5240AF5fc92D5688F3d8053",
  engine: "0x37E36cb34E9E6Ae2dd151FC60E1d022ebfAF15F8",
  vault: "0xF26aFc4E2A2cD1b68aCA1fb189D9C71f389D80F2",
  ledger: "0x2d6A3911714b27344827a981a13a6e3A72b7b1B6",
  disclosure: "0xd750E54E032e91a0365f539e36018D452A20b95a",
  token: "0x3C26B14e6832fb40e8ACBEb1a5b7e2C1D7dD90Ad",
  policy: "0x62Ff582C705Ced87871B0946220827Dd16fcf025",
};

export const deployment = SEPOLIA;

/** Whether the interface has been pointed at a real deployment yet. */
export const isDeployed = deployment.pool !== UNSET;

/** Decimals the confidential token reports. */
export const TOKEN_DECIMALS = 6;
export const TOKEN_SYMBOL = "cUSD";
