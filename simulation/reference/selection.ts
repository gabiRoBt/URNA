/**
 * The selection algorithm: the oracle of correctness for the whole protocol.
 *
 * This is a deliberately literal transcription of what `DrawEngine.sol` does
 * on encrypted state. Every step below has a one-to-one counterpart in the
 * Solidity implementation, in the same order, so a divergence between the two
 * is a bug in the contract rather than a difference in approach.
 *
 * ## Why the draw is publicly verifiable
 *
 * Three quantities are public: the revealed seed, the snapshot's total weight,
 * and each tier's prize amount. From those alone anyone can recompute every
 * tier's `r` and confirm the draw was not steered. What stays encrypted is the
 * mapping from `r` to a winner, because that requires the individual weights.
 *
 * Publishing total weight also makes the comparison against `r` a *scalar*
 * operation on-chain (117k HCU) instead of a ciphertext-to-ciphertext one
 * (152k). That saving is charged once per participant per tier, so it directly
 * buys a larger batch size.
 *
 * ## Why a running "found" flag
 *
 * The obvious formulation, winner is the first `i` where `prefix > r`, needs a
 * data-dependent early exit, which encrypted execution cannot express: the
 * contract may not learn when it has found the winner. Instead every entry is
 * visited unconditionally and a `found` flag, itself encrypted, suppresses all
 * matches after the first. Cost is uniform in the number of participants and
 * the traversal leaks nothing about where the winner sits.
 */

import {
  assertUint64,
  BPS_DENOMINATOR,
  type DrawResult,
  type TierAward,
  type TierConfig,
  type WeightedEntry,
} from "./types";
import { totalWeight } from "./weights";

/**
 * Derives a per-tier seed from the draw's public seed.
 *
 * Injected rather than fixed so the reference model carries no hash
 * dependency. Equivalence tests supply the real `keccak256(seed, tierIndex)`
 * used on-chain; fairness simulations supply a cheap counter-based derivation,
 * since they measure distribution over many draws rather than chain fidelity.
 */
export type TierSeedDerivation = (seed: bigint, tierIndex: number) => bigint;

export interface SelectionInput {
  readonly entries: readonly WeightedEntry[];
  readonly tiers: readonly TierConfig[];
  /** Total prize for this draw, split across tiers by `shareBps`. */
  readonly totalPrize: bigint;
  /** The publicly revealed draw seed. */
  readonly seed: bigint;
  readonly deriveTierSeed: TierSeedDerivation;
}

/**
 * Runs one tier's selection pass over the snapshot.
 *
 * Returns the winning account, or `null` when the snapshot carries no weight
 * at all: a pool where every position is empty has no valid winner, and the
 * contract must roll the prize forward rather than pay it to an arbitrary
 * address.
 */
export function selectTierWinner(
  entries: readonly WeightedEntry[],
  total: bigint,
  r: bigint,
): { account: string; index: number } | null {
  if (total === 0n) return null;
  if (r >= total) {
    throw new RangeError(`draw point ${r} outside weight domain [0, ${total})`);
  }

  let prefix = 0n;
  let found = false;
  let winnerIndex = -1;

  for (const [index, entry] of entries.entries()) {
    prefix = assertUint64(prefix + entry.weight, "prefix sum");

    // Strictly greater, not >=. With weights [10,20,30] and r=10, the winner
    // must be entry 1 (which owns the half-open interval [10,30)), not entry 0
    // whose interval is [0,10). Using >= here shifts every boundary by one
    // ticket and quietly biases the draw toward earlier entries.
    const hit = prefix > r;
    const isWinner = hit && !found;
    found = found || hit;

    if (isWinner) winnerIndex = index;
  }

  // Unreachable while r < total, since prefix ends at total. Kept as an
  // assertion because silently returning null here would look like an empty
  // pool and hide an arithmetic fault.
  if (winnerIndex < 0) {
    throw new Error(`no winner for r=${r} with total weight ${total}`);
  }

  const winner = entries[winnerIndex];
  if (winner === undefined) throw new Error("winner index out of range");
  return { account: winner.account, index: winnerIndex };
}

/** Prize payable to a tier, truncated the same way Solidity truncates. */
export function tierPrize(totalPrize: bigint, tier: TierConfig): bigint {
  return (totalPrize * tier.shareBps) / BPS_DENOMINATOR;
}

/**
 * Executes a full draw: every tier, in order, as an independent pass.
 *
 * Tiers are independent by construction. Each derives its own `r` and re-walks
 * the same snapshot, which keeps per-batch cost constant no matter how many
 * tiers a draw pays out, and lets the engine checkpoint between them.
 *
 * A consequence worth stating plainly: the same account can win more than one
 * tier. That matches how a weighted lottery behaves when draws are independent,
 * and avoiding it would require excluding prior winners, which cannot be done
 * without learning who they are.
 */
export function runDraw(input: SelectionInput): DrawResult {
  const total = totalWeight(input.entries);
  const awards: TierAward[] = [];

  for (const [tierIndex, tier] of input.tiers.entries()) {
    const amount = tierPrize(input.totalPrize, tier);
    if (amount === 0n) continue;
    if (total === 0n) continue;

    const tierSeed = input.deriveTierSeed(input.seed, tierIndex);
    const r = tierSeed % total;
    const winner = selectTierWinner(input.entries, total, r);
    if (winner === null) continue;

    awards.push({ tierIndex, winner: winner.account, amount });
  }

  return {
    seed: input.seed,
    totalWeight: total,
    totalPrize: input.totalPrize,
    awards,
  };
}

/**
 * Validates that a tier configuration is payable.
 *
 * Shares must not exceed 100%; anything less is allowed and rolls the
 * remainder into the next draw, which is how the pool builds a reserve.
 */
export function assertTiersPayable(tiers: readonly TierConfig[]): void {
  const totalBps = tiers.reduce((sum, tier) => sum + tier.shareBps, 0n);
  if (totalBps > BPS_DENOMINATOR) {
    throw new RangeError(`tier shares exceed 100%: ${totalBps} bps`);
  }
}
