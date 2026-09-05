/**
 * HCU models of the two batched loops.
 *
 * Each function builds the exact operation graph the corresponding Solidity
 * loop emits, so the budget report is derived from the algorithm rather than
 * from a hand-maintained estimate. When the selection loop changes, this
 * changes with it and the reported batch size moves accordingly.
 */

import { OpGraph } from "./graph";
import { HCU_LIMIT_DEPTH, HCU_LIMIT_GLOBAL } from "./costs";

export interface BatchProfile {
  readonly label: string;
  readonly participants: number;
  readonly totalCost: number;
  readonly criticalPath: number;
  readonly operations: number;
}

/**
 * One tier's selection pass over `n` participants.
 *
 * The draw point `r` is public, since total weight and seed are both revealed,
 * so the comparison against the prefix sum is scalar. That is the single
 * largest saving in the loop: 117k instead of 152k, per participant, per tier.
 */
export function selectionBatch(n: number): BatchProfile {
  const graph = new OpGraph();

  // Checkpointed state, restored from storage at the start of the batch.
  let prefix = graph.input("prefix (checkpoint)");
  let found = graph.input("found (checkpoint)");

  // The tier's prize, trivially encrypted once and reused for every entry.
  const prize = graph.add("prize constant", "trivialEncrypt", []);

  for (let i = 0; i < n; i++) {
    const weight = graph.input(`weight[${i}]`);
    const pendingBefore = graph.input(`pending[${i}] before`);

    // The prefix chain is the critical path: each sum depends on the last, so
    // depth grows at 162k per participant no matter what else the loop does.
    prefix = graph.add(`prefix += weight[${i}]`, "add", [prefix, weight]);

    const hit = graph.add(`prefix > r [${i}]`, "gt", [prefix], "scalar");
    const notFound = graph.addBool(`!found [${i}]`, "not", [found]);
    const isWinner = graph.addBool(`isWinner[${i}]`, "and", [hit, notFound]);

    // Runs alongside the prefix chain rather than extending it: the or only
    // ever waits on values the comparison already produced.
    found = graph.addBool(`found |= hit [${i}]`, "or", [found, hit]);

    const credit = graph.add(`credit[${i}]`, "select", [isWinner, prize]);
    graph.add(`pending[${i}] += credit`, "add", [pendingBefore, credit]);
  }

  return {
    label: "selection pass (per tier)",
    participants: n,
    totalCost: graph.totalCost,
    criticalPath: graph.criticalPath,
    operations: graph.size,
  };
}

/**
 * Snapshot pass under the tiered weight policy.
 *
 * Unlike selection, participants here are fully independent: there is no chain
 * between them. Depth is therefore constant in `n`, and only the global limit
 * constrains the batch.
 */
export function tieredSnapshotBatch(n: number): BatchProfile {
  const graph = new OpGraph();
  const threshold = graph.input("encrypted threshold");

  for (let i = 0; i < n; i++) {
    const balance = graph.input(`balance[${i}]`);

    // Threshold is a ciphertext, so this comparison cannot use the scalar
    // column. That is the price of keeping the tier boundary confidential,
    // 152k against 116k, and it buys the property that no observer can locate
    // the boundary by watching who qualifies.
    const inTier = graph.add(`balance >= threshold [${i}]`, "ge", [balance, threshold]);
    const shifted = graph.add(`balance >> k [${i}]`, "shr", [balance], "scalar");
    const bonus = graph.add(`bonus[${i}]`, "select", [inTier, shifted]);
    graph.add(`weight[${i}]`, "add", [balance, bonus]);
  }

  return {
    label: "snapshot pass (tiered policy)",
    participants: n,
    totalCost: graph.totalCost,
    criticalPath: graph.criticalPath,
    operations: graph.size,
  };
}

/** Snapshot pass under the linear policy: weight is the balance, no work. */
export function linearSnapshotBatch(n: number): BatchProfile {
  const graph = new OpGraph();
  for (let i = 0; i < n; i++) graph.input(`balance[${i}]`);
  return {
    label: "snapshot pass (linear policy)",
    participants: n,
    totalCost: graph.totalCost,
    criticalPath: graph.criticalPath,
    operations: graph.size,
  };
}

export interface BatchCeiling {
  /** Largest batch that fits both limits. */
  readonly maxParticipants: number;
  /** Which limit binds first. */
  readonly bindingLimit: "global" | "depth" | "none";
  readonly profile: BatchProfile;
}

/**
 * Finds the largest batch that fits inside both transaction limits.
 *
 * Searches upward rather than solving analytically because the graphs carry
 * fixed per-batch overhead alongside their per-participant cost, and a linear
 * fit would quietly mis-round at the boundary, the one place it matters.
 */
export function findBatchCeiling(
  build: (n: number) => BatchProfile,
  searchLimit = 512,
): BatchCeiling {
  let best = 0;
  let profile = build(1);

  for (let n = 1; n <= searchLimit; n++) {
    const candidate = build(n);
    if (candidate.totalCost > HCU_LIMIT_GLOBAL) break;
    if (candidate.criticalPath > HCU_LIMIT_DEPTH) break;
    best = n;
    profile = candidate;
  }

  if (best === 0) {
    return { maxParticipants: 0, bindingLimit: "global", profile };
  }

  const overflow = build(best + 1);
  const globalBinds = overflow.totalCost > HCU_LIMIT_GLOBAL;
  const depthBinds = overflow.criticalPath > HCU_LIMIT_DEPTH;

  return {
    maxParticipants: best,
    bindingLimit: depthBinds ? "depth" : globalBinds ? "global" : "none",
    profile,
  };
}
