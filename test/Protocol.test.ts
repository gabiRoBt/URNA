import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

import {
  decryptFor,
  deployProtocol,
  depositAs,
  encryptOne,
  publishDecrypted,
  type Protocol,
} from "./fixture";

/**
 * Protocol properties beyond selection correctness.
 *
 * Equivalence with the reference model is covered separately. What is checked
 * here is everything the model cannot speak to: access boundaries, lifecycle
 * ordering, the snapshot's stability under concurrent withdrawals, and the
 * disclosure rules that decide who can read a settled award.
 */

const DAY = 24 * 60 * 60;

async function advanceTime(seconds: number): Promise<void> {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

/**
 * Asserts a promise rejects.
 *
 * These are SDK-level rejections rather than on-chain reverts — the KMS
 * declining to decrypt for a caller holding no ACL entry — so the chai revert
 * matchers do not apply and `chai-as-promised` is not in the toolchain.
 */
async function expectRejection(promise: Promise<unknown>, why: string): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
  expect.fail(why);
}

/** Brings a fresh protocol to the point where a draw can be sealed. */
async function fundedProtocol(balances: bigint[], tierSharesBps = [10_000]) {
  const protocol = await deployProtocol({ tierSharesBps });

  for (const [index, balance] of balances.entries()) {
    await depositAs(protocol, protocol.participants[index]!, balance);
  }

  await protocol.pool.requestPrincipalDisclosure();
  await publishDecrypted(await protocol.pool.totalPrincipalHandle(), (value, proof) =>
    protocol.pool.publishPrincipal(value, proof),
  );

  await advanceTime(180 * DAY);
  await protocol.vault.harvest();

  return protocol;
}

/** Seals, publishes, opens, and walks a draw to settlement. */
async function settleDraw(protocol: Protocol, slice = 10): Promise<bigint> {
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

/** The single account holding a non-zero award for a settled draw. */
async function winnerOf(protocol: Protocol, drawId: bigint, count: number) {
  const vaultAddress = await protocol.vault.getAddress();

  for (let index = 0; index < count; index++) {
    const signer = protocol.participants[index]!;
    const handle = await protocol.vault.awardOf(drawId, signer.address);
    const value = await decryptFor(handle, vaultAddress, signer);
    if (value > 0n) return { signer, index, value };
  }

  throw new Error("settled draw paid nobody");
}

describe("Protocol properties", function () {
  before(function () {
    if (!fhevm.isMock) this.skip();
  });

  describe("Snapshot stability", function () {
    it("keeps a sealed draw's outcome when a participant withdraws mid-draw", async function () {
      const balances = [100n, 200n, 300n];
      const protocol = await fundedProtocol(balances);

      await protocol.engine.seal();
      const drawId = await protocol.engine.currentDrawId();

      const sealedTotal = await publishDecrypted(
        await protocol.ledger.sealedTotalWeight(drawId),
        (value, proof) => protocol.engine.publishTotalWeight(drawId, value, proof),
      );
      expect(sealedTotal).to.equal(600n);

      // The largest position exits entirely, after the snapshot closed.
      const leaver = protocol.participants[2]!;
      const exit = await encryptOne(
        await protocol.pool.getAddress(),
        leaver.address,
        300n,
      );
      await protocol.pool.connect(leaver).withdraw(exit.handle, exit.proof);

      await protocol.engine.open(drawId);

      let guard = 0;
      while ((await protocol.engine.stateOf(drawId)) !== 3n) {
        await protocol.engine.advance(drawId, 10);
        expect(++guard).to.be.lessThan(50);
      }

      // The account that left is still eligible for the draw it was part of.
      // Its weight was frozen at seal time, so the walk still covers it.
      const winner = await winnerOf(protocol, drawId, balances.length);
      expect(winner.value).to.be.greaterThan(0n);

      const facts = await protocol.engine.drawFacts(drawId);
      expect(facts[1]).to.equal(
        600n,
        "the draw settles against the weight it froze, not the weight that remains",
      );
    });

    it("excludes accounts that joined after the seal", async function () {
      const protocol = await fundedProtocol([100n, 200n]);

      await protocol.engine.seal();
      const drawId = await protocol.engine.currentDrawId();

      // A third account deposits after the snapshot closed.
      await depositAs(protocol, protocol.participants[2]!, 1_000_000n);

      const sealedTotal = await publishDecrypted(
        await protocol.ledger.sealedTotalWeight(drawId),
        (value, proof) => protocol.engine.publishTotalWeight(drawId, value, proof),
      );

      expect(sealedTotal).to.equal(
        300n,
        "a latecomer cannot buy into a draw whose snapshot already closed",
      );
      expect(await protocol.ledger.sealedCount(drawId)).to.equal(2n);
    });
  });

  describe("Selective disclosure", function () {
    it("keeps an award readable only by its winner until they say otherwise", async function () {
      const balances = [100n, 200n, 300n];
      const protocol = await fundedProtocol(balances);
      const drawId = await settleDraw(protocol);

      const winner = await winnerOf(protocol, drawId, balances.length);
      const handle = await protocol.disclosure.awardHandle(drawId, winner.signer.address);

      expect(await protocol.disclosure.visibilityOf(drawId, winner.signer.address)).to.equal(
        0n,
        "awards start private",
      );

      // Nobody else can read it, and neither can the public path.
      await expectRejection(
        fhevm.publicDecryptEuint(FhevmType.euint64, handle),
        "a private award must not be publicly decryptable",
      );

      const other = protocol.participants[(winner.index + 1) % balances.length]!;
      await expectRejection(
        decryptFor(handle, await protocol.disclosure.getAddress(), other),
        "a private award must not be readable by another participant",
      );
    });

    it("lets the winner open their own award, and only their own", async function () {
      const balances = [100n, 200n, 300n];
      const protocol = await fundedProtocol(balances);
      const drawId = await settleDraw(protocol);

      const winner = await winnerOf(protocol, drawId, balances.length);

      await expect(protocol.disclosure.connect(winner.signer).disclose(drawId))
        .to.emit(protocol.disclosure, "AwardDisclosed")
        .withArgs(drawId, winner.signer.address);

      expect(await protocol.disclosure.visibilityOf(drawId, winner.signer.address)).to.equal(1n);

      const handle = await protocol.disclosure.awardHandle(drawId, winner.signer.address);
      const disclosed = await fhevm.publicDecryptEuint(FhevmType.euint64, handle);
      expect(disclosed).to.equal(winner.value);

      // A second disclosure is refused rather than quietly repeated, so the
      // event log stays an accurate record of the decision.
      await expect(
        protocol.disclosure.connect(winner.signer).disclose(drawId),
      ).to.be.revertedWithCustomError(protocol.disclosure, "AlreadyDisclosed");
    });

    it("refuses to disclose an award the caller does not hold", async function () {
      const protocol = await fundedProtocol([100n, 200n, 300n]);
      const drawId = await settleDraw(protocol);

      // Signers beyond the funded set hold no award at all.
      const stranger = protocol.participants[7]!;
      await expect(
        protocol.disclosure.connect(stranger).disclose(drawId),
      ).to.be.revertedWithCustomError(protocol.disclosure, "NoAwardRecorded");
    });
  });

  describe("Lifecycle", function () {
    it("refuses to open a draw whose total weight is unpublished", async function () {
      const protocol = await fundedProtocol([100n, 200n]);

      await protocol.engine.seal();
      const drawId = await protocol.engine.currentDrawId();

      await expect(protocol.engine.open(drawId)).to.be.revertedWithCustomError(
        protocol.engine,
        "TotalWeightNotPublished",
      );
    });

    it("refuses to advance a draw that has not opened", async function () {
      const protocol = await fundedProtocol([100n, 200n]);

      await protocol.engine.seal();
      const drawId = await protocol.engine.currentDrawId();

      await expect(protocol.engine.advance(drawId, 10)).to.be.revertedWithCustomError(
        protocol.engine,
        "WrongState",
      );
    });

    it("refuses to seal a second draw while one is in flight", async function () {
      const protocol = await fundedProtocol([100n, 200n]);

      await protocol.engine.seal();

      await expect(protocol.engine.seal()).to.be.revertedWithCustomError(
        protocol.engine,
        "WrongState",
      );
    });

    it("releases the ledger once a draw settles, allowing the next one", async function () {
      const protocol = await fundedProtocol([100n, 200n]);
      const first = await settleDraw(protocol);

      expect(await protocol.ledger.frozenDrawId()).to.equal(0n);

      await advanceTime(30 * DAY);
      await protocol.vault.harvest();

      const second = await settleDraw(protocol);
      expect(second).to.equal(first + 1n);
    });

    it("rejects tier shares totalling more than the whole prize", async function () {
      const protocol = await deployProtocol({});
      await expect(
        protocol.engine.configureTiers([6_000, 5_000]),
      ).to.be.revertedWithCustomError(protocol.engine, "TierSharesExceedWhole");
    });
  });

  describe("Access boundaries", function () {
    it("rejects ledger writes from anyone but the pool", async function () {
      const protocol = await deployProtocol({});
      const outsider = protocol.participants[0]!;

      const { handle } = await encryptOne(
        await protocol.ledger.getAddress(),
        outsider.address,
        1_000n,
      );

      await expect(
        protocol.ledger.connect(outsider).sync(outsider.address, handle),
      ).to.be.revertedWithCustomError(protocol.ledger, "NotWriter");
    });

    it("rejects award credits from anyone but the engine", async function () {
      const protocol = await deployProtocol({});
      const outsider = protocol.participants[0]!;

      const { handle } = await encryptOne(
        await protocol.vault.getAddress(),
        outsider.address,
        1_000n,
      );

      await expect(
        protocol.vault.connect(outsider).credit(1, outsider.address, handle),
      ).to.be.revertedWithCustomError(protocol.vault, "NotEngine");
    });

    it("rejects a second wiring attempt", async function () {
      const protocol = await deployProtocol({});
      await expect(
        protocol.vault.wire(protocol.owner.address),
      ).to.be.revertedWithCustomError(protocol.vault, "AlreadyWired");
    });

    it("keeps yield harvesting away from the account that moves principal", async function () {
      const protocol = await deployProtocol({});
      await expect(protocol.yieldSource.harvest()).to.be.revertedWithCustomError(
        protocol.yieldSource,
        "NotHarvester",
      );
    });
  });

  describe("Publishing the total", function () {
    /**
     * The pool publishes one aggregate on purpose. The danger is not that
     * aggregate but a stream of them: two totals taken either side of a
     * single deposit differ by exactly that deposit, and `Deposited` names
     * the account that moved. These check that a snapshot cannot be aimed.
     */

    it("cannot be snapshotted on both sides of a deposit", async function () {
      const protocol = await deployProtocol({});

      await depositAs(protocol, protocol.participants[0]!, 1_000n);
      await protocol.pool.requestPrincipalDisclosure();

      // The attack, in two lines: let someone deposit, then take a second
      // reading and subtract. The second reading is what has to fail.
      await depositAs(protocol, protocol.participants[1]!, 7_777n);

      await expect(protocol.pool.requestPrincipalDisclosure()).to.be.revertedWithCustomError(
        protocol.pool,
        "DisclosureTooSoon",
      );
    });

    it("lets a failed publication retry against the same handle", async function () {
      const protocol = await deployProtocol({});

      await depositAs(protocol, protocol.participants[0]!, 1_000n);
      await protocol.pool.requestPrincipalDisclosure();

      // Nothing has moved, so this asks to disclose a handle that is already
      // public. It reveals nothing new and must not be made to wait an hour.
      await expect(protocol.pool.requestPrincipalDisclosure()).to.not.be.reverted;
    });

    it("allows a fresh snapshot once the interval has passed", async function () {
      const protocol = await deployProtocol({});

      await depositAs(protocol, protocol.participants[0]!, 1_000n);
      await protocol.pool.requestPrincipalDisclosure();
      await depositAs(protocol, protocol.participants[1]!, 7_777n);

      await advanceTime(Number(await protocol.pool.DISCLOSURE_INTERVAL()));

      await expect(protocol.pool.requestPrincipalDisclosure()).to.not.be.reverted;
    });

    it("refuses to disclose a total that does not exist yet", async function () {
      const protocol = await deployProtocol({});

      await expect(protocol.pool.requestPrincipalDisclosure()).to.be.revertedWithCustomError(
        protocol.pool,
        "NoPrincipalYet",
      );
    });
  });

  describe("Yield accounting", function () {
    it("never pays a prize out of principal", async function () {
      const protocol = await fundedProtocol([1_000_000n]);

      const principal = await protocol.yieldSource.totalPrincipal();
      const prize = await protocol.vault.unallocatedPrize();

      expect(principal).to.equal(1_000_000n, "principal is untouched by harvesting");
      expect(prize).to.be.greaterThan(0n, "half a year at 5% must yield something");
      expect(prize).to.be.lessThan(
        principal,
        "a prize larger than principal would mean deposits were paid out",
      );

      // 5% APY over 180 days on 1,000,000 is ~24,657.
      expect(prize).to.be.closeTo(24_657n, 100n);
    });
  });
});
