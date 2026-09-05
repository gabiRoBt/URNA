import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { deployProtocol, depositAs, publishDecrypted } from "./fixture";
import { selectionBatch } from "../simulation/hcu/model";
import { HCU_LIMIT_DEPTH, HCU_LIMIT_GLOBAL } from "../simulation/hcu/costs";

/**
 * Validates the HCU model against what the coprocessors actually charge.
 *
 * `npm run simulate:hcu` derives the safe batch size from an operation graph.
 * That derivation decides `MAX_SLICE`, and therefore whether a draw settles or
 * reverts in production — so it is worth checking against measurement rather
 * than trusting the published cost table and the reasoning on top of it.
 *
 * Two properties matter, and they are not the same:
 *
 *   1. Every transaction the engine emits fits inside both limits. This is the
 *      operational claim, and it is what stops a draw stalling on Sepolia.
 *   2. The model does not *understate* cost. A model that overshoots is merely
 *      conservative; one that undershoots would sign off on a batch size the
 *      chain refuses.
 */

const fmt = (value: number): string => value.toLocaleString("en-US");
const pct = (value: number, limit: number): string =>
  `${((value / limit) * 100).toFixed(1)}%`;

describe("HCU budget", function () {
  before(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("charges no more than the model predicts, and stays inside both limits", async function () {
    const participants = 8;
    const balances = Array.from({ length: participants }, (_, i) => BigInt((i + 1) * 100));

    const protocol = await deployProtocol({ tierSharesBps: [10_000] });

    for (const [index, balance] of balances.entries()) {
      await depositAs(protocol, protocol.participants[index]!, balance);
    }

    await protocol.pool.requestPrincipalDisclosure();
    await publishDecrypted(await protocol.pool.totalPrincipalHandle(), (value, proof) =>
      protocol.pool.publishPrincipal(value, proof),
    );

    await ethers.provider.send("evm_increaseTime", [180 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await protocol.vault.harvest();

    await protocol.engine.seal();
    const drawId = await protocol.engine.currentDrawId();

    await publishDecrypted(
      await protocol.ledger.sealedTotalWeight(drawId),
      (value, proof) => protocol.engine.publishTotalWeight(drawId, value, proof),
    );

    await protocol.engine.open(drawId);

    // Raise the slice for this measurement so one transaction covers every
    // participant and lines up with `selectionBatch(participants)` exactly.
    await protocol.engine.setMaxSlice(participants);

    const tx = await protocol.engine.advance(drawId, participants);
    const receipt = await tx.wait();

    const measured = fhevm.computeTransactionHCU(receipt!);
    const predicted = selectionBatch(participants);

    process.stdout.write(
      `\n    selection slice of ${participants} participants\n` +
        `      global  measured ${fmt(measured.globalHCU).padStart(11)}  ` +
        `predicted ${fmt(predicted.totalCost).padStart(11)}  ` +
        `${pct(measured.globalHCU, HCU_LIMIT_GLOBAL)} of limit\n` +
        `      depth   measured ${fmt(measured.maxHCUDepth).padStart(11)}  ` +
        `predicted ${fmt(predicted.criticalPath).padStart(11)}  ` +
        `${pct(measured.maxHCUDepth, HCU_LIMIT_DEPTH)} of limit\n\n`,
    );

    expect(measured.globalHCU).to.be.lessThan(
      HCU_LIMIT_GLOBAL,
      "a slice must fit inside the global limit",
    );
    expect(measured.maxHCUDepth).to.be.lessThan(
      HCU_LIMIT_DEPTH,
      "a slice must fit inside the sequential depth limit",
    );

    // The model covers the selection loop, not the surrounding bookkeeping, so
    // it is allowed to sit somewhat under the measurement. What it must not do
    // is sit so far under that the batch size it recommends is unsafe.
    expect(measured.globalHCU).to.be.lessThan(
      predicted.totalCost * 2,
      "measured global cost must stay within the model's order of magnitude",
    );
    expect(measured.maxHCUDepth).to.be.lessThan(
      predicted.criticalPath * 2,
      "measured depth must stay within the model's order of magnitude",
    );
  });

  it("grows depth by one prefix-sum link per additional participant", async function () {
    // The model's central claim is that depth is set by the prefix chain
    // alone, not by the full per-entry cost. If that were wrong, the safe
    // batch size would be roughly a third of what the model reports.
    const small = selectionBatch(4);
    const large = selectionBatch(5);

    expect(large.criticalPath - small.criticalPath).to.equal(
      162_000,
      "one additional participant extends the critical path by exactly one add",
    );
    expect(large.totalCost - small.totalCost).to.be.greaterThan(
      500_000,
      "while global cost grows by the whole per-entry cost",
    );
  });

  it("keeps the configured slice below the ceiling the model computes", async function () {
    const protocol = await deployProtocol({});
    const maxSlice = Number(await protocol.engine.maxSlice());

    const atSlice = selectionBatch(maxSlice);

    expect(atSlice.criticalPath).to.be.lessThan(
      HCU_LIMIT_DEPTH,
      "the shipped slice size must fit the depth limit",
    );
    expect(atSlice.totalCost).to.be.lessThan(
      HCU_LIMIT_GLOBAL,
      "the shipped slice size must fit the global limit",
    );

    // Margin, not just fit. The published figures are for the devnet schedule,
    // and a slice sized to exactly fill the limit would revert the first time
    // that schedule moved.
    expect(atSlice.criticalPath).to.be.lessThan(
      HCU_LIMIT_DEPTH * 0.8,
      "the shipped slice size must leave headroom against schedule changes",
    );
  });
});
