import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import {
  decryptFor,
  deployProtocol,
  depositAs,
  encryptOne,
  fixedEntropySource,
  publishDecrypted,
  tieredPolicy,
  type Protocol,
} from "./fixture";
import { selectTierWinner, tierPrize } from "../simulation/reference/selection";
import {
  applyWeights,
  linearWeightPolicy,
  tieredWeightPolicy,
  totalWeight,
} from "../simulation/reference/weights";
import type { WeightedEntry } from "../simulation/reference/types";

/**
 * Equivalence between the deployed contracts and the reference model.
 *
 * The reference model is the oracle: `npm run simulate:fairness` checks it
 * exhaustively, over every draw point rather than a sample. These tests
 * establish the other half — that the Solidity implementation computes the
 * same thing — so the fairness proof carries onto the chain.
 *
 * They run against `FixedPointEntropy`, which lets the test choose the draw
 * point. With real entropy the point is encrypted and unknowable by design, so
 * no test could assert *which* position should have won. That property is
 * covered separately in `Randomness.test.ts`.
 */

const DAY = 24 * 60 * 60;

async function advanceTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/** Brings a protocol to the point where a draw can be sealed. */
async function fund(protocol: Protocol, balances: bigint[]): Promise<void> {
  for (const [index, balance] of balances.entries()) {
    await depositAs(protocol, protocol.participants[index]!, balance);
  }

  await protocol.pool.requestPrincipalDisclosure();
  await publishDecrypted(await protocol.pool.totalPrincipalHandle(), (value, proof) =>
    protocol.pool.publishPrincipal(value, proof),
  );

  await advanceTime(180 * DAY);
  await protocol.vault.harvest();
}

/** Seals, publishes, opens, and walks a draw to settlement. */
async function settle(protocol: Protocol, slice = 10): Promise<bigint> {
  await protocol.engine.seal();
  const drawId = await protocol.engine.currentDrawId();

  await publishDecrypted(await protocol.ledger.sealedTotalWeight(drawId), (value, proof) =>
    protocol.engine.publishTotalWeight(drawId, value, proof),
  );

  await protocol.engine.open(drawId);

  let guard = 0;
  while ((await protocol.engine.stateOf(drawId)) !== 3n) {
    await protocol.engine.advance(drawId, slice);
    expect(++guard).to.be.lessThan(200, "draw failed to converge");
  }

  return drawId;
}

/** Reads every participant's award, one at a time. */
async function awards(
  protocol: Protocol,
  drawId: bigint,
  count: number,
): Promise<{ account: string; value: bigint }[]> {
  const vaultAddress = await protocol.vault.getAddress();
  const results: { account: string; value: bigint }[] = [];

  // Sequential: the mock coprocessor tracks its event log with a single
  // forward-only cursor that concurrent requests interleave and break.
  for (let index = 0; index < count; index++) {
    const signer = protocol.participants[index]!;
    const handle = await protocol.vault.awardOf(drawId, signer.address);
    const value = await decryptFor(handle, vaultAddress, signer);
    results.push({ account: signer.address, value });
  }

  return results;
}

describe("Draw equivalence", function () {
  before(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("pays the position the reference model selects", async function () {
    const balances = [100n, 200n, 300n];
    const protocol = await deployProtocol({ fixedEntropy: true });

    // Point 250 falls in the third position's interval: prefixes are
    // 100, 300, 600, so 250 is the first point where prefix > 250 at index 1.
    await fixedEntropySource(protocol).setPoint(0, 250n);
    await fund(protocol, balances);
    const drawId = await settle(protocol);

    const accounts = protocol.participants
      .slice(0, balances.length)
      .map((signer) => signer.address);

    const entries: WeightedEntry[] = applyWeights(
      balances.map((balance, index) => ({ account: accounts[index]!, balance })),
      linearWeightPolicy,
    ) as WeightedEntry[];

    const expected = selectTierWinner(entries, totalWeight(entries), 250n);
    expect(expected).to.not.equal(null);

    const paid = (await awards(protocol, drawId, balances.length)).filter(
      (award) => award.value > 0n,
    );

    expect(paid).to.have.lengthOf(1, "exactly one tier, so exactly one winner");
    expect(paid[0]!.account).to.equal(
      expected!.account,
      "chain and reference model must agree on the winner",
    );
  });

  it("agrees with the model across every interval boundary", async function () {
    const balances = [100n, 200n, 300n];

    // The boundaries are where an off-by-one hides: 99/100 and 299/300 sit on
    // either side of a position's edge. Checking each side confirms the chain
    // splits the line exactly where the model does.
    const cases: { point: bigint; expectedIndex: number }[] = [
      { point: 0n, expectedIndex: 0 },
      { point: 99n, expectedIndex: 0 },
      { point: 100n, expectedIndex: 1 },
      { point: 299n, expectedIndex: 1 },
      { point: 300n, expectedIndex: 2 },
      { point: 599n, expectedIndex: 2 },
    ];

    for (const { point, expectedIndex } of cases) {
      const protocol = await deployProtocol({ fixedEntropy: true });
      await fixedEntropySource(protocol).setPoint(0, point);
      await fund(protocol, balances);
      const drawId = await settle(protocol);

      const paid = (await awards(protocol, drawId, balances.length)).filter(
        (award) => award.value > 0n,
      );

      expect(paid).to.have.lengthOf(1, `point ${point} must pay exactly one position`);
      expect(paid[0]!.account).to.equal(
        protocol.participants[expectedIndex]!.address,
        `point ${point} must land in position ${expectedIndex}`,
      );
    }
  });

  it("reaches the same outcome regardless of how the walk is sliced", async function () {
    const balances = [100n, 200n, 300n];
    const point = 420n;

    const results: string[] = [];

    for (const slice of [1, 10]) {
      const protocol = await deployProtocol({ fixedEntropy: true });
      await fixedEntropySource(protocol).setPoint(0, point);
      await fund(protocol, balances);
      const drawId = await settle(protocol, slice);

      const paid = (await awards(protocol, drawId, balances.length)).filter(
        (award) => award.value > 0n,
      );
      results.push(paid[0]!.account);
    }

    expect(results[0]).to.equal(
      results[1],
      "checkpointing must not change who wins",
    );
  });

  it("applies the tier bonus to weight without revealing membership", async function () {
    const balances = [1_000n, 999n, 999n];
    const protocol = await deployProtocol({ fixedEntropy: true, bonusShift: 1 });

    const policy = tieredPolicy(protocol);
    const { handle, proof } = await encryptOne(
      await policy.getAddress(),
      protocol.owner.address,
      1_000n,
    );
    await policy.setThreshold(handle, proof);

    await fixedEntropySource(protocol).setPoint(0, 0n);
    await fund(protocol, balances);

    await protocol.engine.seal();
    const drawId = await protocol.engine.currentDrawId();

    const chainTotal = await publishDecrypted(
      await protocol.ledger.sealedTotalWeight(drawId),
      (value, proof_) => protocol.engine.publishTotalWeight(drawId, value, proof_),
    );

    const expected = totalWeight(
      applyWeights(
        balances.map((balance, index) => ({ account: `a${index}`, balance })),
        tieredWeightPolicy({ threshold: 1_000n, bonusShift: 1n }),
      ),
    );

    // 1500 + 999 + 999. A bonus applied to the wrong positions, or not at all,
    // would not produce this total.
    expect(chainTotal).to.equal(expected);
    expect(chainTotal).to.equal(3_498n);
  });

  it("splits a multi-tier prize the way the model does", async function () {
    const balances = [100n, 200n, 300n];
    const protocol = await deployProtocol({
      fixedEntropy: true,
      tierSharesBps: [6_000, 4_000],
    });

    const entropy = fixedEntropySource(protocol);
    await entropy.setPoint(0, 50n); // first position
    await entropy.setPoint(1, 500n); // third position

    await fund(protocol, balances);
    const drawId = await settle(protocol);

    const prize = (await protocol.engine.drawFacts(drawId))[2];
    const paid = await awards(protocol, drawId, balances.length);

    expect(paid[0]!.value).to.equal(
      tierPrize(prize, { shareBps: 6_000n }),
      "first tier pays the position its point selected",
    );
    expect(paid[1]!.value).to.equal(0n, "middle position won neither tier");
    expect(paid[2]!.value).to.equal(
      tierPrize(prize, { shareBps: 4_000n }),
      "second tier pays the position its point selected",
    );

    const total = paid.reduce((sum, award) => sum + award.value, 0n);
    expect(total).to.equal(
      tierPrize(prize, { shareBps: 6_000n }) + tierPrize(prize, { shareBps: 4_000n }),
      "awards must sum to the configured share of the prize",
    );
  });
});
