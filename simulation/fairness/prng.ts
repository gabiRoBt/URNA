/**
 * SplitMix64: a deterministic 64-bit generator for simulation input.
 *
 * Chosen for reproducibility rather than cryptographic strength: a failing
 * simulation must be replayable from its seed alone. It is never used to
 * produce a draw seed in production; that comes from the commit-reveal
 * entropy source on-chain.
 */

import { UINT64_MODULUS } from "../reference/types";

const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n;
const MIX_A = 0xbf58476d1ce4e5b9n;
const MIX_B = 0x94d049bb133111ebn;

const mask64 = (value: bigint): bigint => value & (UINT64_MODULUS - 1n);

export interface Prng {
  /** Next raw 64-bit value. */
  next(): bigint;
  /** Uniform value in `[0, bound)`. Throws when `bound` is zero. */
  below(bound: bigint): bigint;
}

export function splitMix64(seed: bigint): Prng {
  let state = mask64(seed);

  const next = (): bigint => {
    state = mask64(state + GOLDEN_GAMMA);
    let z = state;
    z = mask64((z ^ (z >> 30n)) * MIX_A);
    z = mask64((z ^ (z >> 27n)) * MIX_B);
    return mask64(z ^ (z >> 31n));
  };

  return {
    next,
    below(bound) {
      if (bound <= 0n) throw new RangeError(`bound must be positive: ${bound}`);

      // Rejection sampling. Taking `next() % bound` directly would over-weight
      // the low residues whenever bound does not divide 2^64, a bias small
      // enough to hide inside the tolerance of a fairness test, which is
      // exactly the kind of flaw this harness exists to catch.
      const limit = UINT64_MODULUS - (UINT64_MODULUS % bound);
      let candidate = next();
      while (candidate >= limit) candidate = next();
      return candidate % bound;
    },
  };
}
