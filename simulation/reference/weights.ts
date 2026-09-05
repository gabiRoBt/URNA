/**
 * Weight policies: the rule that turns a confidential balance into draw weight.
 *
 * The policy is the seam that lets the pool change how odds are computed
 * without the draw engine knowing anything about it. On-chain this is
 * `IWeightPolicy`; here it is the same contract expressed as a function type,
 * so the two can be compared case for case.
 */

import { assertUint64, type Position, type WeightedEntry } from "./types";

export interface WeightPolicy {
  /** Stable name, used in simulation reports and to key equivalence tests. */
  readonly name: string;
  /** Derives draw weight from a confidential position. Must be pure. */
  weigh(position: Position): bigint;
}

/**
 * Weight equals balance. One unit deposited is one ticket.
 *
 * This is the baseline PoolTogether rule and the fallback the protocol drops
 * back to if the tiered policy is ever withdrawn.
 */
export const linearWeightPolicy: WeightPolicy = {
  name: "linear",
  weigh: (position) => assertUint64(position.balance, "linear weight"),
};

export interface TieredWeightConfig {
  /**
   * Balance at or above which the bonus applies.
   *
   * Stored as an `euint64` on-chain: the threshold itself is confidential, so
   * an observer cannot work out where the tier boundary sits, and participants
   * cannot tell which of their peers cleared it.
   */
  readonly threshold: bigint;
  /**
   * Bonus expressed as a right-shift of the balance: the tier adds
   * `balance >> bonusShift` on top of the base weight.
   *
   * A shift rather than a multiplier is a deliberate cost decision. Scalar
   * `mul` on euint64 costs 365k HCU against a scalar shift's 34k, and that
   * difference is charged once per participant per snapshot.
   *
   * shift 1 gives 1.5x weight, shift 2 gives 1.25x, shift 3 gives 1.125x.
   */
  readonly bonusShift: bigint;
}

/**
 * Weight equals balance plus a bonus for positions at or above a confidential
 * threshold.
 *
 * Both the threshold and each account's membership in the tier stay encrypted.
 * The draw engine consumes the resulting weight without ever learning whether a
 * bonus was applied: the branch is a `FHE.select`, not a control-flow branch.
 */
export function tieredWeightPolicy(config: TieredWeightConfig): WeightPolicy {
  if (config.bonusShift < 0n || config.bonusShift > 63n) {
    throw new RangeError(`bonusShift outside shift domain: ${config.bonusShift}`);
  }
  assertUint64(config.threshold, "tier threshold");

  return {
    name: `tiered(threshold=${config.threshold},shift=${config.bonusShift})`,
    weigh: (position) => {
      const qualifies = position.balance >= config.threshold;
      const bonus = qualifies ? position.balance >> config.bonusShift : 0n;
      return assertUint64(position.balance + bonus, "tiered weight");
    },
  };
}

/**
 * Applies a policy across a snapshot.
 *
 * Order is preserved and load-bearing: the selection algorithm walks these
 * entries as a prefix sum, so the same input order must produce the same
 * traversal on-chain and in the model.
 */
export function applyWeights(
  positions: readonly Position[],
  policy: WeightPolicy,
): readonly WeightedEntry[] {
  return positions.map((position) => ({
    account: position.account,
    balance: position.balance,
    weight: policy.weigh(position),
  }));
}

/** Sum of all weights in a snapshot: the domain the draw seed maps into. */
export function totalWeight(entries: readonly WeightedEntry[]): bigint {
  return entries.reduce(
    (sum, entry) => assertUint64(sum + entry.weight, "total weight"),
    0n,
  );
}
