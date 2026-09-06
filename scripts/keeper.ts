import { ethers, fhevm } from "hardhat";

import deployment from "../deployments/11155111.json";
import type {
  ConfidentialTokenMock,
  DrawEngine,
  PrizeVault,
  TicketLedger,
} from "../types";

/**
 * Draws, on a schedule, forever.
 *
 * This is what "automated draws" means here, and it is deliberately
 * unremarkable: every call it makes is one anyone could make. Sealing is
 * permissionless on a cadence, and publishing the weight, opening and
 * advancing were always open, so this program has no authority the pool
 * depends on. Kill it and someone else's copy carries on; run two and they
 * race harmlessly, because whichever loses finds the work already done.
 *
 * That is the property worth having. A keeper that alone can start a draw is
 * a single point of failure wearing a cron job's clothes.
 *
 * The one thing it does that not everyone can: if the signer happens to own
 * the vault and the reserve is empty, it tops the reserve up, because a draw
 * that awards nothing is not worth the gas. A keeper run by anyone else skips
 * that step and draws for whatever is already there.
 *
 *   npx.cmd hardhat run scripts/keeper.ts --network sepolia
 *
 * Stops after KEEPER_DRAWS draws if that is set, otherwise runs until killed.
 */

/** Topped up when the reserve is empty and this signer is the vault's owner. */
const TOP_UP = 1_250n * 10n ** 6n;

/** Positions per transaction. Below the engine's own ceiling. */
const SLICE = 10;

/** How often to look again while waiting for the cadence. */
const POLL_MS = 15_000;

const settled = 3n;

async function main(): Promise<void> {
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  if (signer === undefined) throw new Error("no signer configured");

  const at = async <T>(name: string, address: string): Promise<T> =>
    (await ethers.getContractAt(name, address, signer)) as unknown as T;

  const token = await at<ConfidentialTokenMock>("ConfidentialTokenMock", deployment.token);
  const ledger = await at<TicketLedger>("TicketLedger", deployment.ledger);
  const vault = await at<PrizeVault>("PrizeVault", deployment.vault);
  const engine = await at<DrawEngine>("DrawEngine", deployment.engine);

  const say = (text: string): void => {
    process.stdout.write(`  [${new Date().toISOString().slice(11, 19)}] ${text}\n`);
  };

  const limit = Number(process.env["KEEPER_DRAWS"] ?? 0);
  const interval = await engine.DRAW_INTERVAL();

  process.stdout.write(
    `\n  Keeping draws for ${deployment.pool} as ${signer.address}\n` +
      `  cadence ${interval}s, slice ${SLICE}${limit > 0 ? `, stopping after ${limit} draws` : ""}\n\n`,
  );

  let completed = 0;

  for (;;) {
    // A draw already in flight is picked up rather than restarted. Somebody
    // else's keeper — or a reviewer pressing buttons in the app — may have
    // taken it partway, and finishing their draw is the same work.
    //
    // Checked before the cadence, deliberately. The interval governs when a
    // *new* draw may start; applying it to one already sealed would leave the
    // pool waiting on a clock for work that is already overdue.
    let drawId = await engine.currentDrawId();
    let state = drawId === 0n ? settled : await engine.stateOf(drawId);

    if (state === settled) {
      if (await ledger.participantCount() === 0n) {
        say("nobody has deposited yet; waiting");
        await sleep(POLL_MS);
        continue;
      }

      // ── Wait for the cadence ──────────────────────────────────────────────

      const lastSeal = await engine.lastSealAt();
      if (lastSeal !== 0n) {
        const now = BigInt((await ethers.provider.getBlock("latest"))?.timestamp ?? 0);
        const allowedAt = lastSeal + interval;
        if (now < allowedAt) {
          say(`next draw allowed in ${allowedAt - now}s`);
          await sleep(Number(allowedAt - now) * 1000 + POLL_MS);
          continue;
        }
      }

      await topUpIfOwned();

      say("sealing");
      await (await engine.seal()).wait();
      drawId = await engine.currentDrawId();
      state = await engine.stateOf(drawId);
      say(`draw ${drawId} sealed over ${await ledger.sealedCount(drawId)} position(s)`);
    } else {
      say(`resuming draw ${drawId}`);
    }

    // ── Publish the snapshot's weight ───────────────────────────────────────

    const facts = await engine.drawFacts(drawId);
    if (facts[1] === 0n) {
      say("publishing total weight");
      const handle = await ledger.sealedTotalWeight(drawId);
      const published = await fhevm.publicDecrypt([handle]);
      const values = published.clearValues as Record<string, string | number | bigint>;
      const key = Object.keys(values).find(
        (candidate) => candidate.toLowerCase() === handle.toLowerCase(),
      );
      if (key === undefined) throw new Error("relayer returned no total weight");

      await (
        await engine.publishTotalWeight(drawId, BigInt(values[key]!), published.decryptionProof)
      ).wait();
    }

    // ── Open ────────────────────────────────────────────────────────────────

    if ((await engine.stateOf(drawId)) === 1n) {
      say("opening; the draw point is generated here and never decrypted");
      await (await engine.open(drawId)).wait();
    }

    // ── Walk ────────────────────────────────────────────────────────────────

    let slices = 0;
    while ((await engine.stateOf(drawId)) !== settled) {
      const receipt = await (await engine.advance(drawId, SLICE)).wait();
      slices += 1;
      say(`slice ${slices}: ${receipt?.gasUsed.toLocaleString()} gas`);
    }

    completed += 1;
    say(`draw ${drawId} settled in ${slices} transactions`);

    if (limit > 0 && completed >= limit) {
      say(`stopping after ${completed} draw(s)`);
      return;
    }

    process.stdout.write("\n");
  }

  /**
   * Puts a prize up, but only if this signer is the one entitled to and the
   * reserve is empty. A keeper nobody privileged is running simply draws for
   * whatever is already there.
   */
  async function topUpIfOwned(): Promise<void> {
    if ((await vault.unallocatedPrize()) > 0n) return;
    if ((await vault.owner()).toLowerCase() !== signer!.address.toLowerCase()) {
      say("reserve is empty and this signer cannot fund it; drawing for nothing");
      return;
    }

    say(`reserve empty; funding ${TOP_UP}`);
    const deadline = ((await ethers.provider.getBlock("latest"))?.timestamp ?? 0) + 86_400;
    await (await token.mint(signer!.address, TOP_UP)).wait();
    await (await token.setOperator(deployment.vault, deadline)).wait();
    await (await vault.fundPrize(TOP_UP)).wait();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
