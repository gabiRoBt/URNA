/**
 * HCU budget report.
 *
 * Derives the maximum safe batch size from the operation graphs and checks
 * that the configured batch sits inside it with margin. Run after any change
 * to the selection loop: this is what stops a change that passes locally from
 * reverting on Sepolia.
 *
 *   npm run simulate:hcu
 */

import { HCU_LIMIT_DEPTH, HCU_LIMIT_GLOBAL } from "./costs";
import {
  findBatchCeiling,
  linearSnapshotBatch,
  selectionBatch,
  tieredSnapshotBatch,
  type BatchProfile,
} from "./model";
import { check, section, summarize } from "../fairness/harness";

/**
 * Batch size the contracts ship with.
 *
 * Held below the computed ceiling on purpose. The published HCU figures are
 * for the devnet schedule and the exact accounting of depth on the
 * coprocessors is not something this model can confirm on its own, so the
 * margin absorbs both. It is a constructor parameter on-chain, not a constant,
 * and gets calibrated against a real Sepolia run before submission.
 */
const CONFIGURED_BATCH_SIZE = 20;

/** Fraction of the ceiling we are willing to spend. */
const SAFETY_FACTOR = 0.75;

const pct = (value: number, limit: number): string =>
  `${((value / limit) * 100).toFixed(1)}%`;

const fmt = (value: number): string => value.toLocaleString("en-US");

function report(profile: BatchProfile): void {
  process.stdout.write(
    `  ${profile.label} | ${profile.participants} participants\n` +
      `    global ${fmt(profile.totalCost).padStart(12)}  ` +
      `${pct(profile.totalCost, HCU_LIMIT_GLOBAL).padStart(6)} of limit\n` +
      `    depth  ${fmt(profile.criticalPath).padStart(12)}  ` +
      `${pct(profile.criticalPath, HCU_LIMIT_DEPTH).padStart(6)} of limit\n` +
      `    ops    ${fmt(profile.operations).padStart(12)}\n`,
  );
}

process.stdout.write(
  `\nTransaction limits: ${fmt(HCU_LIMIT_GLOBAL)} global, ` +
    `${fmt(HCU_LIMIT_DEPTH)} sequential depth\n`,
);

// ---------------------------------------------------------------------------

section("Selection pass: one tier over one batch");
{
  const ceiling = findBatchCeiling(selectionBatch);
  report(ceiling.profile);
  process.stdout.write(
    `    ceiling ${ceiling.maxParticipants} participants ` +
      `(bound by ${ceiling.bindingLimit})\n\n`,
  );

  const configured = selectionBatch(CONFIGURED_BATCH_SIZE);
  report(configured);

  const budget = Math.floor(ceiling.maxParticipants * SAFETY_FACTOR);
  check(
    "configured batch fits within safety factor",
    CONFIGURED_BATCH_SIZE <= budget,
    `configured ${CONFIGURED_BATCH_SIZE}, ceiling ${ceiling.maxParticipants}, ` +
      `budget at ${SAFETY_FACTOR * 100}% is ${budget}`,
  );
  check(
    "depth is the binding constraint",
    ceiling.bindingLimit === "depth",
    `the prefix-sum chain binds first at ${ceiling.maxParticipants} participants, ` +
      `global budget still has ${pct(
        HCU_LIMIT_GLOBAL - ceiling.profile.totalCost,
        HCU_LIMIT_GLOBAL,
      )} headroom`,
  );

  // Per-participant marginal cost, measured rather than assumed.
  const marginalDepth =
    selectionBatch(21).criticalPath - selectionBatch(20).criticalPath;
  const marginalGlobal = selectionBatch(21).totalCost - selectionBatch(20).totalCost;
  check(
    "marginal depth is one prefix-sum link",
    marginalDepth === 162_000,
    `each additional participant adds ${fmt(marginalDepth)} depth ` +
      `and ${fmt(marginalGlobal)} global: depth grows only by the add that ` +
      `extends the prefix chain, not by the whole per-entry cost`,
  );
}

// ---------------------------------------------------------------------------

section("Snapshot pass: weight derivation");
{
  const tiered = findBatchCeiling(tieredSnapshotBatch);
  report(tiered.profile);
  process.stdout.write(
    `    ceiling ${tiered.maxParticipants} participants ` +
      `(bound by ${tiered.bindingLimit})\n\n`,
  );

  check(
    "tiered snapshot depth is constant in batch size",
    tieredSnapshotBatch(4).criticalPath === tieredSnapshotBatch(64).criticalPath,
    `depth stays at ${fmt(tieredSnapshotBatch(64).criticalPath)} whether the ` +
      `batch holds 4 or 64 participants: entries carry no dependency on ` +
      `each other, so only the global limit applies`,
  );
  check(
    "tiered snapshot admits a larger batch than selection",
    tiered.maxParticipants > findBatchCeiling(selectionBatch).maxParticipants,
    `snapshot ceiling ${tiered.maxParticipants} vs selection ceiling ` +
      `${findBatchCeiling(selectionBatch).maxParticipants}`,
  );

  const linear = linearSnapshotBatch(CONFIGURED_BATCH_SIZE);
  check(
    "linear policy costs nothing at snapshot time",
    linear.totalCost === 0,
    "weight is the balance handle itself, no FHE work, which is why the " +
      "linear policy is the safe fallback if budget ever gets tight",
  );
}

// ---------------------------------------------------------------------------

section("Full draw cost");
{
  const TIERS = 3;
  const POOL = 100;

  const batchesPerTier = Math.ceil(POOL / CONFIGURED_BATCH_SIZE);
  const snapshotBatches = Math.ceil(POOL / CONFIGURED_BATCH_SIZE);
  const totalTransactions = snapshotBatches + batchesPerTier * TIERS;

  const perSelection = selectionBatch(CONFIGURED_BATCH_SIZE);
  const perSnapshot = tieredSnapshotBatch(CONFIGURED_BATCH_SIZE);
  const totalHcu =
    perSnapshot.totalCost * snapshotBatches +
    perSelection.totalCost * batchesPerTier * TIERS;

  process.stdout.write(
    `  pool of ${POOL}, ${TIERS} tiers, batch ${CONFIGURED_BATCH_SIZE}\n` +
      `    ${snapshotBatches} snapshot + ${batchesPerTier * TIERS} selection ` +
      `= ${totalTransactions} transactions\n` +
      `    ${fmt(totalHcu)} HCU total across the draw\n\n`,
  );

  check(
    "every transaction in a full draw stays inside both limits",
    perSelection.totalCost <= HCU_LIMIT_GLOBAL &&
      perSelection.criticalPath <= HCU_LIMIT_DEPTH &&
      perSnapshot.totalCost <= HCU_LIMIT_GLOBAL &&
      perSnapshot.criticalPath <= HCU_LIMIT_DEPTH,
    `worst transaction uses ${pct(
      Math.max(perSelection.totalCost, perSnapshot.totalCost),
      HCU_LIMIT_GLOBAL,
    )} of global and ${pct(
      Math.max(perSelection.criticalPath, perSnapshot.criticalPath),
      HCU_LIMIT_DEPTH,
    )} of depth`,
  );

  // Linearity is a statement about marginal cost, not about totals: each batch
  // also pays a small fixed overhead (the trivially-encrypted prize constant),
  // so cost(2n) sits 32 HCU below 2 x cost(n). Comparing totals would fail on
  // that overhead while telling us nothing about scaling.
  const marginalAt = (n: number): number =>
    selectionBatch(n + 1).totalCost - selectionBatch(n).totalCost;

  check(
    "draw scales linearly, not quadratically, in pool size",
    marginalAt(5) === marginalAt(20) && marginalAt(20) === marginalAt(60),
    `marginal cost is a flat ${fmt(marginalAt(20))} HCU per participant at ` +
      `every pool size, so a draw is O(participants x tiers) with no ` +
      `combinatorial blow-up; each batch adds a fixed ` +
      `${fmt(selectionBatch(1).totalCost - marginalAt(1))} HCU of overhead`,
  );
}

summarize();
