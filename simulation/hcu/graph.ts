/**
 * A tiny dependency graph for FHE operations.
 *
 * The point of modelling the batch as a graph rather than a running total is
 * that the two transaction limits measure different things. The global limit
 * is the sum of all work; the depth limit is the longest chain of *dependent*
 * work. Adding operations that run alongside existing ones costs global budget
 * but no depth at all.
 *
 * Estimating depth by summing per-participant cost, the intuitive shortcut,
 * understates the achievable batch size by roughly 3x, because the prefix-sum
 * chain and the found-flag chain advance in parallel rather than in series.
 */

import { hcu, hcuBool, type BoolOpName, type OpName, type Operand } from "./costs";

export interface Node {
  readonly id: number;
  readonly label: string;
  readonly cost: number;
  readonly deps: readonly number[];
}

export class OpGraph {
  readonly #nodes: Node[] = [];

  /** Adds an operation and returns its handle. */
  add(
    label: string,
    op: OpName,
    deps: readonly number[],
    operand: Operand = "ciphertext",
  ): number {
    const id = this.#nodes.length;
    this.#nodes.push({ id, label, cost: hcu(op, operand), deps });
    return id;
  }

  /** Adds a boolean operation, billed on the cheaper ebool schedule. */
  addBool(
    label: string,
    op: BoolOpName,
    deps: readonly number[],
    operand: Operand = "ciphertext",
  ): number {
    const id = this.#nodes.length;
    this.#nodes.push({ id, label, cost: hcuBool(op, operand), deps });
    return id;
  }

  /** Records a value that already exists: storage reads, constants. Free. */
  input(label: string): number {
    const id = this.#nodes.length;
    this.#nodes.push({ id, label, cost: 0, deps: [] });
    return id;
  }

  /** Total complexity: every operation counted once. */
  get totalCost(): number {
    return this.#nodes.reduce((sum, node) => sum + node.cost, 0);
  }

  /**
   * Critical path: the most expensive chain of dependent operations.
   *
   * Nodes are appended in dependency order, so a single forward pass is
   * enough: no topological sort needed, and the invariant is cheap to assert.
   */
  get criticalPath(): number {
    const longest = new Array<number>(this.#nodes.length).fill(0);
    let deepest = 0;

    for (const node of this.#nodes) {
      let inherited = 0;
      for (const dep of node.deps) {
        if (dep >= node.id) {
          throw new Error(
            `node ${node.id} (${node.label}) depends on ${dep}, which is not yet defined`,
          );
        }
        inherited = Math.max(inherited, longest[dep] ?? 0);
      }
      const depth = inherited + node.cost;
      longest[node.id] = depth;
      if (depth > deepest) deepest = depth;
    }

    return deepest;
  }

  get size(): number {
    return this.#nodes.length;
  }
}
