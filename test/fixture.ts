import { ethers, fhevm } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { FhevmType } from "@fhevm/hardhat-plugin";

import type {
  ConfidentialPrizePool,
  ConfidentialTokenMock,
  DisclosureRegistry,
  DrawEngine,
  FheRandomEntropy,
  FixedPointEntropy,
  LinearWeightPolicy,
  PrizeVault,
  SimulatedYieldSource,
  TicketLedger,
  TieredWeightPolicy,
} from "../types";

/**
 * Deploys the whole protocol and closes the wiring cycle.
 *
 * The contracts reference each other in a loop — the ledger needs the pool and
 * the engine, the engine needs the vault, the vault needs the registry — so
 * construction cannot resolve it. Each of them exposes a one-time `wire` call
 * instead, and this fixture is the only place that order is spelled out.
 */
export interface Protocol {
  token: ConfidentialTokenMock;
  /** Either policy implementation; tests that need the tier reach for `tieredPolicy`. */
  policy: LinearWeightPolicy | TieredWeightPolicy;
  ledger: TicketLedger;
  yieldSource: SimulatedYieldSource;
  disclosure: DisclosureRegistry;
  vault: PrizeVault;
  entropy: FheRandomEntropy | FixedPointEntropy;
  engine: DrawEngine;
  pool: ConfidentialPrizePool;
  owner: HardhatEthersSigner;
  participants: HardhatEthersSigner[];
}

/**
 * The tiered policy, for tests that configure a threshold.
 *
 * Narrowing here rather than at each call site keeps the assertion in one
 * place: a test that asks for the tiered policy after deploying the linear one
 * gets a clear failure instead of a missing-method error.
 */
export function tieredPolicy(protocol: Protocol): TieredWeightPolicy {
  if (!("setThreshold" in protocol.policy)) {
    throw new Error("protocol was deployed with the linear policy");
  }
  return protocol.policy;
}

/** The fixed-point entropy source, for tests that pin the draw point. */
export function fixedEntropySource(protocol: Protocol): FixedPointEntropy {
  if (!("setPoint" in protocol.entropy)) {
    throw new Error("protocol was deployed with real entropy");
  }
  return protocol.entropy;
}

export interface DeployOptions {
  /** Basis points of annual yield the simulated venue pays. */
  apyBps?: number;
  /** Prize split across tiers, in basis points. */
  tierSharesBps?: number[];
  /** Right-shift forming the tier bonus; omit for the linear policy. */
  bonusShift?: number;
  /**
   * Use a fixed draw point instead of real randomness.
   *
   * Needed by any test that asserts *which* position won: with
   * `FheRandomEntropy` the point is encrypted and unknowable, so the most a
   * test can check is that exactly one position was paid.
   */
  fixedEntropy?: boolean;
}

/**
 * Deploys a contract and returns it typed.
 *
 * `getContractFactory` is typed through the generated `hardhat.d.ts`, so the
 * only cast needed is the deployed instance — ethers types `deploy` as
 * returning the base contract regardless of the factory it came from.
 */
async function deploy<T>(name: string, ...args: unknown[]): Promise<T> {
  const factory = await ethers.getContractFactory(name);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract as unknown as T;
}

export async function deployProtocol(options: DeployOptions = {}): Promise<Protocol> {
  const {
    apyBps = 500,
    tierSharesBps = [10_000],
    bonusShift,
    fixedEntropy = false,
  } = options;

  const signers = await ethers.getSigners();
  const owner = signers[0]!;
  const participants = signers.slice(1);

  const token = await deploy<ConfidentialTokenMock>(
    "ConfidentialTokenMock",
    "Confidential USD",
    "cUSD",
  );

  const policy =
    bonusShift === undefined
      ? await deploy<LinearWeightPolicy>("LinearWeightPolicy")
      : await deploy<TieredWeightPolicy>("TieredWeightPolicy", owner.address, bonusShift);

  const ledger = await deploy<TicketLedger>(
    "TicketLedger",
    owner.address,
    await policy.getAddress(),
  );
  const yieldSource = await deploy<SimulatedYieldSource>(
    "SimulatedYieldSource",
    owner.address,
    apyBps,
  );
  const disclosure = await deploy<DisclosureRegistry>("DisclosureRegistry", owner.address);

  const vault = await deploy<PrizeVault>(
    "PrizeVault",
    owner.address,
    await yieldSource.getAddress(),
    await disclosure.getAddress(),
  );

  const entropy = fixedEntropy
    ? await deploy<FixedPointEntropy>("FixedPointEntropy")
    : await deploy<FheRandomEntropy>("FheRandomEntropy");

  const engine = await deploy<DrawEngine>(
    "DrawEngine",
    owner.address,
    await ledger.getAddress(),
    await entropy.getAddress(),
    await vault.getAddress(),
  );

  const pool = await deploy<ConfidentialPrizePool>(
    "ConfidentialPrizePool",
    owner.address,
    await token.getAddress(),
    await ledger.getAddress(),
    await yieldSource.getAddress(),
  );

  await ledger.wire(await pool.getAddress(), await engine.getAddress());
  await vault.wire(await engine.getAddress());
  await disclosure.wire(await vault.getAddress());
  await yieldSource.wire(await pool.getAddress(), await vault.getAddress());

  await engine.configureTiers(tierSharesBps);

  return {
    token,
    policy,
    ledger,
    yieldSource,
    disclosure,
    vault,
    entropy,
    engine,
    pool,
    owner,
    participants,
  };
}

/**
 * Encrypts a single amount and returns the handle and proof.
 *
 * The SDK returns handles as an array, so indexing it yields `T | undefined`.
 * Checking once here rather than asserting at each call site means a malformed
 * encryption surfaces as a clear failure instead of as a confusing ABI error
 * several frames later.
 */
export async function encryptOne(
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): Promise<{ handle: Uint8Array; proof: Uint8Array }> {
  const encrypted = await fhevm
    .createEncryptedInput(contractAddress, userAddress)
    .add64(amount)
    .encrypt();

  const handle = encrypted.handles[0];
  if (handle === undefined) {
    throw new Error("encryption returned no handle");
  }

  return { handle, proof: encrypted.inputProof };
}

/** Funds an account and deposits `amount` into the pool on its behalf. */
export async function depositAs(
  protocol: Protocol,
  account: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const tokenAddress = await protocol.token.getAddress();
  const poolAddress = await protocol.pool.getAddress();

  await protocol.token.mint(account.address, amount);

  // The pool moves tokens with `confidentialTransferFrom`, which requires the
  // holder to have named it an operator first. The deadline has to come from
  // chain time, not wall-clock time: tests advance the chain by months, so a
  // `Date.now()`-derived deadline is already in the past by the second draw.
  const latest = await ethers.provider.getBlock("latest");
  const until = (latest?.timestamp ?? 0) + 365 * 24 * 60 * 60;
  await protocol.token.connect(account).setOperator(poolAddress, until);

  const { handle, proof } = await encryptOne(poolAddress, account.address, amount);
  await protocol.pool.connect(account).deposit(handle, proof);

  void tokenAddress;
}

/**
 * Publishes an encrypted total on-chain, going through the same decrypt-then-
 * prove path a real caller would: the KMS produces the cleartext and a proof,
 * and the contract verifies the proof against the handle it froze.
 */
export async function publishDecrypted(
  handle: string,
  submit: (cleartext: bigint, proof: string) => Promise<unknown>,
): Promise<bigint> {
  const results = await fhevm.publicDecrypt([handle]);

  // Handle casing is not guaranteed to round-trip, so look the value up
  // case-insensitively rather than assuming the relayer echoes our spelling.
  const clearValues = results.clearValues as Record<string, string | number | bigint>;
  const key = Object.keys(clearValues).find(
    (candidate) => candidate.toLowerCase() === handle.toLowerCase(),
  );

  if (key === undefined) {
    throw new Error(`no cleartext returned for handle ${handle}`);
  }

  const cleartext = BigInt(clearValues[key]!);
  await submit(cleartext, results.decryptionProof);
  return cleartext;
}

/** Reads an account's own encrypted value. */
export async function decryptFor(
  handle: string,
  contractAddress: string,
  account: HardhatEthersSigner,
): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, account);
}
