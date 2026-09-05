/**
 * FHE operation costs and the transaction budget they must fit inside.
 *
 * Source: https://docs.zama.org/protocol/solidity-guides/development-guide/hcu
 * Figures are for `euint64`. Narrower types are cheaper, but the pool stores
 * balances as euint64 (the width ERC7984 uses), so nothing here benefits from
 * the smaller tables.
 */

/** Global homomorphic complexity allowed in one transaction. */
export const HCU_LIMIT_GLOBAL = 20_000_000;

/**
 * Sequential-depth complexity allowed in one transaction.
 *
 * This bounds the *critical path* through the operation graph, not the sum of
 * all operations. Independent work does not accumulate against it, which is
 * why the batch model below computes a longest path rather than a total.
 */
export const HCU_LIMIT_DEPTH = 5_000_000;

/**
 * Cost of one operation, split by whether the second operand is a plaintext
 * scalar or another ciphertext.
 *
 * The gap matters: comparing an encrypted prefix sum against a *public* draw
 * point costs 117k, while comparing it against an encrypted one costs 152k.
 * Publishing the draw point is what makes the cheaper form available, and that
 * saving is charged once per participant per tier.
 */
export interface OpCost {
  readonly scalar: number;
  readonly ciphertext: number;
}

const cost = (scalar: number, ciphertext: number): OpCost => ({ scalar, ciphertext });

export const EUINT64_COST = {
  add: cost(133_000, 162_000),
  sub: cost(133_000, 162_000),
  mul: cost(365_000, 596_000),
  lt: cost(118_000, 146_000),
  le: cost(119_000, 149_000),
  gt: cost(117_000, 152_000),
  ge: cost(116_000, 152_000),
  eq: cost(83_000, 120_000),
  ne: cost(84_000, 118_000),
  min: cost(150_000, 219_000),
  max: cost(149_000, 218_000),
  neg: cost(131_000, 131_000),

  // Shifting by a public amount costs 34k against a scalar `mul`'s 365k. That
  // ratio is why the tier bonus is expressed as `balance >> k` rather than as
  // a percentage multiplier: same effect on odds, an order of magnitude less
  // budget, charged once per participant per snapshot.
  shr: cost(34_000, 209_000),
  shl: cost(34_000, 208_000),

  and: cost(34_000, 34_000),
  or: cost(34_000, 34_000),
  select: cost(55_000, 55_000),
  rand: cost(24_000, 24_000),
  trivialEncrypt: cost(32, 32),
} as const satisfies Record<string, OpCost>;

/**
 * Boolean operations are billed on their own, cheaper schedule.
 *
 * Worth keeping separate rather than folding into the euint64 table: the
 * selection loop runs three of these per participant, and charging them at
 * euint64 rates overstates the batch cost by around 5%.
 */
export const EBOOL_COST = {
  and: cost(22_000, 25_000),
  or: cost(22_000, 24_000),
  xor: cost(2_000, 22_000),
  not: cost(2, 2),
  select: cost(55_000, 55_000),
} as const satisfies Record<string, OpCost>;

export type OpName = keyof typeof EUINT64_COST;
export type BoolOpName = keyof typeof EBOOL_COST;

/** Operand kind, which selects the column of the cost table. */
export type Operand = "scalar" | "ciphertext";

export function hcu(op: OpName, operand: Operand = "ciphertext"): number {
  return EUINT64_COST[op][operand];
}

export function hcuBool(op: BoolOpName, operand: Operand = "ciphertext"): number {
  return EBOOL_COST[op][operand];
}
