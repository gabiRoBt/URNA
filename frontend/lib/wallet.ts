/**
 * Wallet connection, kept deliberately small.
 *
 * No connector library. The page needs one thing — an injected EIP-1193
 * provider — and a wallet-selection framework would add a dependency tree,
 * a set of visual conventions, and a modal, none of which this interface
 * wants.
 */

"use client";

import { BrowserProvider, type Eip1193Provider, type JsonRpcSigner } from "ethers";

import { deployment } from "./config";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export interface Connection {
  readonly address: string;
  readonly chainId: number;
  readonly provider: BrowserProvider;
  readonly signer: JsonRpcSigner;
  readonly injected: Eip1193Provider;
}

export function hasWallet(): boolean {
  return typeof window !== "undefined" && window.ethereum !== undefined;
}

/**
 * Reconnects without prompting, if the wallet already trusts this site.
 *
 * `eth_accounts` reports what has already been authorised and never opens a
 * dialogue; `eth_requestAccounts` asks. Refreshing the page was dropping the
 * connection and putting "Connect wallet" back in front of someone who had
 * connected a minute earlier, along with everything they had revealed. This
 * restores it silently, and returns null when there is genuinely nothing to
 * restore.
 */
export async function restore(): Promise<Connection | null> {
  const injected = window.ethereum;
  if (injected === undefined) return null;

  const provider = new BrowserProvider(injected);
  const accounts = (await provider.send("eth_accounts", [])) as string[];
  if (accounts.length === 0) return null;

  const signer = await provider.getSigner();
  const network = await provider.getNetwork();

  return {
    address: await signer.getAddress(),
    chainId: Number(network.chainId),
    provider,
    signer,
    injected,
  };
}

export async function connect(): Promise<Connection> {
  const injected = window.ethereum;
  if (injected === undefined) {
    throw new Error("No Ethereum wallet found in this browser.");
  }

  const provider = new BrowserProvider(injected);
  await provider.send("eth_requestAccounts", []);

  const signer = await provider.getSigner();
  const network = await provider.getNetwork();

  return {
    address: await signer.getAddress(),
    chainId: Number(network.chainId),
    provider,
    signer,
    injected,
  };
}

/** Asks the wallet to move to the deployment's network. */
export async function switchToDeploymentChain(): Promise<void> {
  const injected = window.ethereum;
  if (injected === undefined) return;

  await injected.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: `0x${deployment.chainId.toString(16)}` }],
  });
}

/** Turns a wallet or RPC error into something worth showing a person. */
export function readableError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { shortMessage?: string; reason?: string; message?: string; code?: number };

    if (candidate.code === 4001) return "Request rejected in wallet.";

    // Not a contract error, so it never reaches the table below, and the
    // node's own wording is a wall of wei.
    if (
      typeof candidate.message === "string" &&
      candidate.message.includes("insufficient funds")
    ) {
      return "Not enough Sepolia ETH in this wallet to pay for gas.";
    }
    if (candidate.reason !== undefined && candidate.reason !== "") return candidate.reason;
    if (candidate.shortMessage !== undefined) return candidate.shortMessage;

    if (candidate.message !== undefined) {
      // Custom errors surface as `execution reverted: ErrorName(args)`. The
      // name is the useful part; the ABI encoding after it is not.
      const custom = /reverted(?: with custom error)?:?\s*'?([A-Za-z_]\w*)/.exec(
        candidate.message,
      );
      if (custom !== null) return humanise(custom[1]!);
      return candidate.message.split("\n")[0]!;
    }
  }
  return "Something went wrong.";
}

/** `ThresholdNotSet` becomes `Threshold not set`. */
/**
 * Plain sentences for the failures a user can actually cause.
 *
 * The fallback below turns `ERC7984UnauthorizedSpender` into "Erc7984
 * unauthorized spender", which is a contract's vocabulary spoken at someone
 * who never opened the contract. Each entry here says what happened and what
 * to do about it; anything not listed still degrades to the readable-ish
 * fallback rather than to a hex blob.
 */
const EXPLAINED: Record<string, string> = {
  ERC7984UnauthorizedSpender:
    "The pool is not approved to move your tokens yet. Use the faucet panel once — it mints and approves in the same step.",
  ERC7984ZeroBalance: "That account holds none of this token.",
  NothingDeposited: "You have no position in the pool yet. Deposit first.",
  NothingToClaim: "There is nothing to claim for this draw.",
  AlreadyClaimed: "This award has already been claimed.",
  AlreadyDisclosed: "This award is already public. Disclosure cannot be undone.",
  NoAwardRecorded: "This account was not part of the draw.",
  DrawTooSoon: "The next draw cannot start yet. Draws run on a fixed cadence.",
  NoParticipants: "Nobody has deposited yet, so there is nothing to draw over.",
  WrongState: "The draw has moved on. Refresh and try again.",
  TotalWeightNotPublished: "The draw's total weight has not been published yet.",
  DisclosureTooSoon:
    "The pool's total was published recently. Snapshots are limited to one an hour, so they cannot be read around a single deposit.",
  PrincipalUnchanged: "The published total is already up to date.",
  ThresholdNotSet: "This deployment has no tier threshold set yet.",
  OwnableUnauthorizedAccount: "That action is the operator's.",
  SenderNotAllowedToUseHandle:
    "This account is not allowed to read that value — which is the point of it being encrypted.",
};

function humanise(errorName: string): string {
  const explained = EXPLAINED[errorName];
  if (explained !== undefined) return explained;

  const spaced = errorName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
