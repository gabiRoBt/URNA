/**
 * Fairness simulation.
 *
 * Establishes that the selection algorithm pays out in exact proportion to
 * weight, that the tier bonus does what it claims, and that prizes are
 * conserved. Run before touching `DrawEngine.sol` and after every change to
 * the selection loop.
 *
 *   npm run simulate:fairness
 */

import {
  runDraw,
  selectTierWinner,
  tierPrize,
  assertTiersPayable,
} from "../reference/selection";
import { BPS_DENOMINATOR, type Position, type TierConfig } from "../reference/types";
import {
  applyWeights,
  linearWeightPolicy,
  tieredWeightPolicy,
  totalWeight,
} from "../reference/weights";
import { splitMix64 } from "./prng";
import { check, checkRatio, section, summarize } from "./harness";

const SIMULATION_SEED = 0x5057_1_5n;

/**
 * Cheap, deterministic tier-seed derivation. Chain fidelity is not the point
 * here (distribution is), so this avoids pulling in a keccak implementation.
 */
const deriveTierSeed = (seed: bigint, tierIndex: number): bigint =>
  splitMix64(seed + BigInt(tierIndex) * 0x9e37_79b9n).next();

const positions = (...balances: readonly bigint[]): readonly Position[] =>
  balances.map((balance, index) => ({ account: `acct-${index}`, balance }));

// ---------------------------------------------------------------------------
// 1. Exhaustive interval coverage
//
// The strongest statement available: for a small pool, walk *every* draw point
// in [0, totalWeight) and confirm each account wins exactly as many points as
// it holds weight. This is a proof of proportional fairness over the whole
// domain, not a sample of it. It catches off-by-one boundary errors that a
// Monte Carlo run would bury inside its tolerance.
// ---------------------------------------------------------------------------

function exhaustiveCoverage(balances: readonly bigint[], label: string): void {
  const entries = applyWeights(positions(...balances), linearWeightPolicy);
  const total = totalWeight(entries);
  const wins = new Map<string, bigint>();

  for (let r = 0n; r < total; r++) {
    const winner = selectTierWinner(entries, total, r);
    if (winner === null) throw new Error("unexpected empty pool");
    wins.set(winner.account, (wins.get(winner.account) ?? 0n) + 1n);
  }

  const mismatches = entries.filter(
    (entry) => (wins.get(entry.account) ?? 0n) !== entry.weight,
  );

  check(
    `exhaustive coverage: ${label}`,
    mismatches.length === 0,
    mismatches.length === 0
      ? `every one of ${total} draw points maps to the account holding it ` +
          `(${entries.length} accounts)`
      : `weight/win mismatch for: ${mismatches
          .map((e) => `${e.account} holds ${e.weight}, won ${wins.get(e.account) ?? 0n}`)
          .join("; ")}`,
  );
}

section("Exhaustive interval coverage");
exhaustiveCoverage([10n, 20n, 30n], "unequal weights");
exhaustiveCoverage([1n, 1n, 1n, 1n, 1n], "equal weights");
exhaustiveCoverage([1n, 999n], "extreme imbalance");
exhaustiveCoverage([500n], "single participant");
exhaustiveCoverage([0n, 50n, 0n, 50n], "zero-weight accounts interleaved");

// ---------------------------------------------------------------------------
// 2. Zero-weight accounts can never win
// ---------------------------------------------------------------------------

section("Zero-weight exclusion");
{
  const entries = applyWeights(positions(0n, 100n, 0n), linearWeightPolicy);
  const total = totalWeight(entries);
  let zeroWeightWins = 0;

  for (let r = 0n; r < total; r++) {
    const winner = selectTierWinner(entries, total, r);
    if (winner !== null && (winner.index === 0 || winner.index === 2)) zeroWeightWins++;
  }

  check(
    "empty positions never selected",
    zeroWeightWins === 0,
    `${zeroWeightWins} wins across ${total} draw points for accounts holding no weight`,
  );
}

// ---------------------------------------------------------------------------
// 3. Tier bonus produces the exact advertised uplift
// ---------------------------------------------------------------------------

section("Tiered weight policy");
{
  const threshold = 1_000n;
  const policy = tieredWeightPolicy({ threshold, bonusShift: 1n }); // 1.5x

  const below = policy.weigh({ account: "a", balance: 999n });
  const atThreshold = policy.weigh({ account: "b", balance: 1_000n });
  const above = policy.weigh({ account: "c", balance: 2_000n });

  check("below threshold receives no bonus", below === 999n, `balance 999 to weight ${below}`);
  check(
    "threshold is inclusive",
    atThreshold === 1_500n,
    `balance 1000 to weight ${atThreshold} (expected 1500)`,
  );
  check(
    "bonus scales with balance",
    above === 3_000n,
    `balance 2000 to weight ${above} (expected 3000)`,
  );

  // Odds uplift is the whole point of the tier, so measure it as odds rather
  // than as raw weight: an equal-balance pool where one account clears the
  // threshold must see that account's win share rise by exactly the ratio of
  // its weight to the pool's.
  const balances = [1_000n, 999n, 999n, 999n];
  const tiered = applyWeights(positions(...balances), policy);
  const total = totalWeight(tiered);
  const qualifier = tiered[0];
  if (qualifier === undefined) throw new Error("missing qualifying entry");

  const expectedShare = Number(qualifier.weight) / Number(total);
  const flatShare = 1_000 / (1_000 + 999 * 3);

  let qualifierWins = 0n;
  for (let r = 0n; r < total; r++) {
    const winner = selectTierWinner(tiered, total, r);
    if (winner?.index === 0) qualifierWins++;
  }

  const measured = Number(qualifierWins) / Number(total);
  checkRatio("tiered odds match weight share", measured, expectedShare, 1e-12);
  check(
    "tier meaningfully improves odds",
    measured > flatShare,
    `tiered ${(measured * 100).toFixed(2)}% vs untiered ${(flatShare * 100).toFixed(2)}%`,
  );
}

// ---------------------------------------------------------------------------
// 4. Distribution at scale
// ---------------------------------------------------------------------------

section("Monte Carlo distribution");
{
  const DRAWS = 200_000;
  const prng = splitMix64(SIMULATION_SEED);

  const balances = [100n, 200n, 300n, 400n];
  const entries = applyWeights(positions(...balances), linearWeightPolicy);
  const total = totalWeight(entries);
  const wins = new Map<string, number>();

  for (let draw = 0; draw < DRAWS; draw++) {
    const winner = selectTierWinner(entries, total, prng.below(total));
    if (winner === null) throw new Error("unexpected empty pool");
    wins.set(winner.account, (wins.get(winner.account) ?? 0) + 1);
  }

  // Four sigma on a binomial proportion. Wide enough not to flake, tight
  // enough that a systematic bias of even half a percent trips it.
  for (const entry of entries) {
    const expected = Number(entry.weight) / Number(total);
    const sigma = Math.sqrt((expected * (1 - expected)) / DRAWS);
    const measured = (wins.get(entry.account) ?? 0) / DRAWS;
    checkRatio(`${entry.account} win share`, measured, expected, 4 * sigma);
  }
}

// ---------------------------------------------------------------------------
// 5. Prize conservation across tiers
// ---------------------------------------------------------------------------

section("Prize conservation");
{
  const tiers: readonly TierConfig[] = [
    { shareBps: 5_000n },
    { shareBps: 3_000n },
    { shareBps: 2_000n },
  ];
  assertTiersPayable(tiers);

  const totalPrize = 1_000_000n;
  const entries = applyWeights(positions(100n, 200n, 300n), linearWeightPolicy);

  const result = runDraw({
    entries,
    tiers,
    totalPrize,
    seed: SIMULATION_SEED,
    deriveTierSeed,
  });

  const awarded = result.awards.reduce((sum, award) => sum + award.amount, 0n);
  const expected = tiers.reduce((sum, tier) => sum + tierPrize(totalPrize, tier), 0n);

  check(
    "awards sum to the configured share",
    awarded === expected,
    `awarded ${awarded} of ${totalPrize} (expected ${expected}, ` +
      `${tiers.reduce((s, t) => s + t.shareBps, 0n)} bps)`,
  );
  check(
    "every tier pays exactly one winner",
    result.awards.length === tiers.length,
    `${result.awards.length} awards for ${tiers.length} tiers`,
  );
  check(
    "no tier over-pays the pool",
    awarded <= totalPrize,
    `awarded ${awarded}, pool holds ${totalPrize}`,
  );
}

// ---------------------------------------------------------------------------
// 6. Tier independence
//
// Each tier derives its own draw point, so tiers must not collapse onto the
// same winner by construction. With a heavily skewed pool a repeat winner is
// legitimate, so this measures across many draws rather than asserting on one.
// ---------------------------------------------------------------------------

section("Tier independence");
{
  const DRAWS = 20_000;
  const tiers: readonly TierConfig[] = [{ shareBps: 6_000n }, { shareBps: 4_000n }];
  const entries = applyWeights(positions(250n, 250n, 250n, 250n), linearWeightPolicy);
  const prng = splitMix64(SIMULATION_SEED ^ 0xabcdn);

  let identicalWinners = 0;
  for (let draw = 0; draw < DRAWS; draw++) {
    const result = runDraw({
      entries,
      tiers,
      totalPrize: 100_000n,
      seed: prng.next(),
      deriveTierSeed,
    });
    const [first, second] = result.awards;
    if (first !== undefined && second !== undefined && first.winner === second.winner) {
      identicalWinners++;
    }
  }

  // Four equal accounts, independent tiers, so collision probability is 1/4.
  const measured = identicalWinners / DRAWS;
  const sigma = Math.sqrt((0.25 * 0.75) / DRAWS);
  checkRatio("tier collision rate", measured, 0.25, 4 * sigma);
}

// ---------------------------------------------------------------------------
// 7. Degenerate pools
// ---------------------------------------------------------------------------

section("Degenerate pools");
{
  const empty = runDraw({
    entries: [],
    tiers: [{ shareBps: BPS_DENOMINATOR }],
    totalPrize: 1_000n,
    seed: SIMULATION_SEED,
    deriveTierSeed,
  });
  check(
    "empty pool awards nothing",
    empty.awards.length === 0 && empty.totalWeight === 0n,
    `${empty.awards.length} awards, total weight ${empty.totalWeight}`,
  );

  const allZero = runDraw({
    entries: applyWeights(positions(0n, 0n, 0n), linearWeightPolicy),
    tiers: [{ shareBps: BPS_DENOMINATOR }],
    totalPrize: 1_000n,
    seed: SIMULATION_SEED,
    deriveTierSeed,
  });
  check(
    "pool of empty positions awards nothing",
    allZero.awards.length === 0,
    `${allZero.awards.length} awards for a pool holding no weight`,
  );

  const dust = runDraw({
    entries: applyWeights(positions(1n), linearWeightPolicy),
    tiers: [{ shareBps: BPS_DENOMINATOR }],
    totalPrize: 1_000n,
    seed: SIMULATION_SEED,
    deriveTierSeed,
  });
  check(
    "lone participant wins every tier",
    dust.awards.length === 1 && dust.awards[0]?.winner === "acct-0",
    `winner ${dust.awards[0]?.winner ?? "none"}, amount ${dust.awards[0]?.amount ?? 0n}`,
  );

  const rounded = tierPrize(999n, { shareBps: 3_333n });
  check(
    "tier prize truncates like Solidity",
    rounded === (999n * 3_333n) / BPS_DENOMINATOR,
    `999 x 3333bps gives ${rounded} (integer division, remainder stays in the pool)`,
  );
}

summarize();
