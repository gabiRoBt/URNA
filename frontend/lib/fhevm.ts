/**
 * The Zama SDK instance, and the two operations the interface needs from it.
 *
 * Encryption and decryption both happen in the browser. Nothing here sends a
 * plaintext amount anywhere: `encryptAmount` produces a ciphertext and a proof
 * before the transaction is built, and `decryptOwn` reads a value the caller
 * already holds an on-chain permission for.
 */

import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import type { Eip1193Provider, TypedDataDomain, TypedDataField } from "ethers";

import { deployment } from "./config";

/**
 * Signs an EIP-712 payload.
 *
 * Declared here rather than taken from ethers directly so the caller can pass
 * any signer that can produce one — a wallet, a hardware device, a test
 * double. The SDK builds the payload; this only signs it.
 */
export type TypedDataSigner = (
  domain: TypedDataDomain,
  types: Record<string, TypedDataField[]>,
  message: Record<string, unknown>,
) => Promise<string>;

let instancePromise: Promise<FhevmInstance> | null = null;

/**
 * Loads the SDK and builds an instance, once per page.
 *
 * The import is dynamic because the SDK carries a WebAssembly module: pulling
 * it in at module scope would block the first render on a download the page
 * does not need until the user actually acts.
 */
export function getInstance(provider: Eip1193Provider): Promise<FhevmInstance> {
  if (instancePromise === null) {
    instancePromise = (async () => {
      const { initSDK, createInstance, SepoliaConfig } = await import(
        "@zama-fhe/relayer-sdk/web"
      );
      await initSDK();
      return createInstance({ ...SepoliaConfig, network: provider });
    })().catch((error: unknown) => {
      // A failed load must not poison every later attempt.
      instancePromise = null;
      throw error;
    });
  }
  return instancePromise;
}

/** Encrypts an amount for a specific contract and caller. */
export async function encryptAmount(
  provider: Eip1193Provider,
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: string; proof: string }> {
  const instance = await getInstance(provider);
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  input.add64(amount);
  const encrypted = await input.encrypt();

  return {
    handle: toHex(encrypted.handles[0]!),
    proof: toHex(encrypted.inputProof),
  };
}

/** Cached decryption authorisation, so one signature covers a session. */
interface Authorisation {
  privateKey: string;
  publicKey: string;
  signature: string;
  contracts: string[];
  startTimestamp: number;
  durationDays: number;
}

let authorisation: Authorisation | null = null;

const AUTH_DURATION_DAYS = 1;

/**
 * Decrypts a value the caller is permitted to read.
 *
 * The first call asks for a signature; later calls in the same session reuse
 * it. That is a deliberate trade: re-prompting on every balance refresh trains
 * people to approve signatures without reading them.
 */
export async function decryptOwn(
  provider: Eip1193Provider,
  handle: string,
  contractAddress: string,
  userAddress: string,
  signTypedData: TypedDataSigner,
): Promise<bigint> {
  const instance = await getInstance(provider);

  const contracts = uniqueContracts(contractAddress);

  if (authorisation === null || !covers(authorisation, contracts)) {
    const keypair = instance.generateKeypair();
    const startTimestamp = Math.floor(Date.now() / 1000);

    const eip712 = instance.createEIP712(
      keypair.publicKey,
      contracts,
      startTimestamp,
      AUTH_DURATION_DAYS,
    );

    // Only the request type is passed on. The SDK's payload also carries
    // EIP712Domain, which ethers derives from the domain itself and rejects as
    // a duplicate if it is handed over explicitly.
    //
    // The field list is copied rather than cast: the SDK declares it readonly
    // and ethers wants a mutable array, and a spread says that plainly where a
    // double cast would just silence the difference.
    const signature = await signTypedData(
      eip712.domain as TypedDataDomain,
      {
        UserDecryptRequestVerification: [
          ...eip712.types["UserDecryptRequestVerification"],
        ] as TypedDataField[],
      },
      eip712.message as Record<string, unknown>,
    );

    authorisation = {
      privateKey: keypair.privateKey,
      publicKey: keypair.publicKey,
      signature: signature.replace(/^0x/, ""),
      contracts,
      startTimestamp,
      durationDays: AUTH_DURATION_DAYS,
    };
  }

  const auth = authorisation;
  const results = await instance.userDecrypt(
    [{ handle, contractAddress }],
    auth.privateKey,
    auth.publicKey,
    auth.signature,
    auth.contracts,
    userAddress,
    auth.startTimestamp,
    auth.durationDays,
  );

  return readValue(results, handle);
}

/** Decrypts a value its holder has chosen to make public. */
export async function decryptPublic(
  provider: Eip1193Provider,
  handle: string,
): Promise<bigint> {
  const instance = await getInstance(provider);
  const results = await instance.publicDecrypt([handle]);

  // The two decryption paths return different shapes: user decryption yields
  // the handle-to-value map directly, public decryption wraps it alongside the
  // KMS proof. Only the map is wanted here.
  return readValue(results.clearValues, handle);
}

/** Clears the cached signature, e.g. when the connected account changes. */
/**
 * Decrypts a public handle and keeps the proof that came with it.
 *
 * `decryptPublic` above answers "what is this value"; this answers "what is
 * this value, and how do I convince a contract of it". The KMS signatures are
 * what `publishTotalWeight` and `publishPrincipal` check, so a caller who
 * throws them away cannot complete either.
 */
export async function decryptPublicWithProof(
  provider: Eip1193Provider,
  handle: string,
): Promise<{ value: bigint; proof: string }> {
  const instance = await getInstance(provider);
  const results = await instance.publicDecrypt([handle]);

  return {
    value: readValue(results.clearValues, handle),
    proof: results.decryptionProof,
  };
}

export function resetAuthorisation(): void {
  authorisation = null;
}

/**
 * Every contract whose handles this session may need to read.
 *
 * Authorisation is scoped to a contract list, so listing them together means
 * one signature covers reading a balance, an award, and a disclosure rather
 * than three separate prompts.
 */
function uniqueContracts(extra: string): string[] {
  const all = [
    deployment.pool,
    deployment.vault,
    deployment.disclosure,
    deployment.token,
    extra,
  ];
  return [...new Set(all.map((address) => address.toLowerCase()))];
}

function covers(auth: Authorisation, contracts: string[]): boolean {
  const held = new Set(auth.contracts);
  const stillValid =
    Date.now() / 1000 < auth.startTimestamp + auth.durationDays * 86_400;
  return stillValid && contracts.every((address) => held.has(address));
}

/**
 * Reads one handle's value out of a decryption result.
 *
 * Looks the key up case-insensitively rather than indexing directly: handle
 * casing is not guaranteed to round-trip through the relayer, and a direct
 * index would return undefined for a value that is actually present.
 */
function readValue(values: Record<string, unknown>, handle: string): bigint {
  const key = Object.keys(values).find(
    (candidate) => candidate.toLowerCase() === handle.toLowerCase(),
  );
  if (key === undefined) {
    throw new Error("the relayer returned no value for that handle");
  }
  return BigInt(values[key] as string | number | bigint);
}

function toHex(bytes: Uint8Array | string): string {
  if (typeof bytes === "string") return bytes;
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
