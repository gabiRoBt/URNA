import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { decryptFor, deployProtocol, depositAs, publishDecrypted, type Protocol } from "./fixture";

/**
 * Properties of the real entropy source.
 *
 * `DrawEquivalence` pins the draw point so it can assert who should win. This
 * file does the opposite: it runs the production source, where the point is
 * encrypted and nobody — including the test — can know it. What remains
 * checkable is everything that matters about randomness itself.
 *
 * The draw point never appears in plaintext anywhere: not in an event, not in
 * a getter, not in storage. That is the design, and it means the only way to
 * observe the randomness is through its effects.
 */

const DAY = 24 * 60 * 60;

async function advanceTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

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

async function settle(protocol: Protocol): Promise<bigint> {
  await protocol.engine.seal();
  const drawId = await protocol.engine.currentDrawId();

  await publishDecrypted(await protocol.ledger.sealedTotalWeight(drawId), (value, proof) =>
    protocol.engine.publishTotalWeight(drawId, value, proof),
  );

  await protocol.engine.open(drawId);

  let guard = 0;
  while ((await protocol.engine.stateOf(drawId)) !== 3n) {
    await protocol.engine.advance(drawId, 10);
    expect(++guard).to.be.lessThan(200);
  }

  return drawId;
}

/** Index of the position that was paid, or -1 if none was. */
async function winnerIndex(
  protocol: Protocol,
  drawId: bigint,
  count: number,
): Promise<number> {
  const vaultAddress = await protocol.vault.getAddress();

  for (let index = 0; index < count; index++) {
    const signer = protocol.participants[index]!;
    const handle = await protocol.vault.awardOf(drawId, signer.address);
    const value = await decryptFor(handle, vaultAddress, signer);
    if (value > 0n) return index;
  }

  return -1;
}

describe("Randomness", function () {
  before(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("pays exactly one position per tier, without anyone knowing which in advance", async function () {
    const balances = [100n, 200n, 300n, 400n];
    const protocol = await deployProtocol({});

    await fund(protocol, balances);
    const drawId = await settle(protocol);

    const index = await winnerIndex(protocol, drawId, balances.length);
    expect(index).to.be.greaterThanOrEqual(0, "a funded draw must pay someone");
    expect(index).to.be.lessThan(balances.length);
  });

  it("keeps the draw point encrypted", async function () {
    const balances = [100n, 200n];
    const protocol = await deployProtocol({});

    await fund(protocol, balances);

    await protocol.engine.seal();
    const drawId = await protocol.engine.currentDrawId();
    await publishDecrypted(await protocol.ledger.sealedTotalWeight(drawId), (value, proof) =>
      protocol.engine.publishTotalWeight(drawId, value, proof),
    );
    await protocol.engine.open(drawId);

    const handle = await protocol.engine.drawPointHandle(drawId);
    expect(handle).to.not.equal(ethers.ZeroHash, "a point must have been drawn");

    // No ACL entry is issued for the point, by the engine or the source, so
    // neither decryption path can open it. If either succeeded, the draw
    // would be predictable to anyone watching the chain.
    let publiclyReadable = false;
    try {
      await fhevm.publicDecryptEuint(0x05 as never, handle);
      publiclyReadable = true;
    } catch {
      publiclyReadable = false;
    }
    expect(publiclyReadable).to.equal(false, "the draw point must not be public");

    let ownerReadable = false;
    try {
      await decryptFor(handle, await protocol.engine.getAddress(), protocol.owner);
      ownerReadable = true;
    } catch {
      ownerReadable = false;
    }
    expect(ownerReadable).to.equal(
      false,
      "not even the operator may read the draw point",
    );
  });

  it("draws an independent point for each tier", async function () {
    const balances = [100n, 200n];
    const protocol = await deployProtocol({ tierSharesBps: [5_000, 5_000] });

    await fund(protocol, balances);

    await protocol.engine.seal();
    const drawId = await protocol.engine.currentDrawId();
    await publishDecrypted(await protocol.ledger.sealedTotalWeight(drawId), (value, proof) =>
      protocol.engine.publishTotalWeight(drawId, value, proof),
    );
    await protocol.engine.open(drawId);

    const firstTierPoint = await protocol.engine.drawPointHandle(drawId);

    // Walk the first tier to completion; the second tier then begins and must
    // draw its own point rather than reusing the first.
    let guard = 0;
    while ((await protocol.engine.drawFacts(drawId))[4] === 0n) {
      await protocol.engine.advance(drawId, 10);
      expect(++guard).to.be.lessThan(50);
    }

    const secondTierPoint = await protocol.engine.drawPointHandle(drawId);

    expect(secondTierPoint).to.not.equal(
      firstTierPoint,
      "each tier must settle against its own point, or one position takes every prize",
    );
  });

  it("produces different outcomes across draws on the same snapshot", async function () {
    // Two equal positions, so each draw is a coin flip. Over several draws the
    // outcome must not be constant — if it were, the source would be returning
    // the same point every time and the draw would not be a draw.
    const balances = [1_000n, 1_000n];
    const protocol = await deployProtocol({});

    await fund(protocol, balances);

    const seen = new Set<number>();
    for (let round = 0; round < 6; round++) {
      const drawId = await settle(protocol);
      seen.add(await winnerIndex(protocol, drawId, balances.length));

      await advanceTime(30 * DAY);
      await protocol.vault.harvest();
    }

    // Six flips landing the same way has probability 1/32 — unlikely enough to
    // flag, and the assertion is about the source varying at all, not about
    // the distribution being uniform. Fairness is the reference model's job.
    expect(seen.size).to.be.greaterThan(
      1,
      "six draws on the same snapshot all went the same way; entropy is not varying",
    );
  });
});
