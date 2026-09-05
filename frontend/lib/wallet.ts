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
function humanise(errorName: string): string {
  const spaced = errorName.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
