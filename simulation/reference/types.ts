/**
 * Core value types for the reference model.
 *
 * Every quantity that maps onto an `euint64` in Solidity is represented as a
 * `bigint` here, never a `number`. The reference model exists to be bit-exact
 * with the on-chain implementation, and IEEE-754 doubles lose that guarantee
 * above 2^53 — well inside the range a uint64 balance can reach.
 */

/** Upper bound of the `euint64` domain, exclusive. */
export const UINT64_MODULUS = 1n << 64n;

/** Largest representable `euint64` value. */
export const UINT64_MAX = UINT64_MODULUS - 1n;

/** Denominator for share values expressed in basis points. */
export const BPS_DENOMINATOR = 10_000n;

/**
 * An account identifier. The reference model does not care about address
 * formatting, only about identity and ordering, so a plain string keeps the
 * model free of any chain-specific dependency.
 */
export type AccountId = string;

/** A participant's confidential position at the moment a snapshot is taken. */
export interface Position {
  readonly account: AccountId;
  /** Principal deposited. On-chain this is an `euint64`. */
  readonly balance: bigint;
}

/**
 * A participant's draw weight, derived from their balance by a weight policy.
 *
 * Weight is kept separate from balance because the tiered policy makes them
 * diverge: two accounts with different balances can hold the same weight, and
 * an account's weight reveals nothing about which tier produced it.
 */
export interface WeightedEntry {
  readonly account: AccountId;
  readonly balance: bigint;
  readonly weight: bigint;
}

/**
 * One prize tier within a draw.
 *
 * Tiers are drawn in sequence, each as an independent pass over the snapshot.
 * `shareBps` is the fraction of the draw's total prize that this tier pays out.
 */
export interface TierConfig {
  readonly shareBps: bigint;
}

/** The outcome of a single tier's selection pass. */
export interface TierAward {
  readonly tierIndex: number;
  readonly winner: AccountId;
  readonly amount: bigint;
}

/** The complete outcome of one draw. */
export interface DrawResult {
  readonly seed: bigint;
  readonly totalWeight: bigint;
  readonly totalPrize: bigint;
  readonly awards: readonly TierAward[];
}

/**
 * Asserts that a value is inside the `euint64` domain.
 *
 * Solidity's FHE arithmetic wraps silently on overflow, which would turn a
 * modelling mistake into a plausible-looking number instead of a failure. The
 * reference model refuses to model anything it cannot represent faithfully.
 */
export function assertUint64(value: bigint, label: string): bigint {
  if (value < 0n || value > UINT64_MAX) {
    throw new RangeError(`${label} outside uint64 domain: ${value}`);
  }
  return value;
}
