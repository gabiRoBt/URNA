import { ethers, fhevm } from "hardhat";

import deployment from "../deployments/11155111.json";
import type { DrawEngine, PrizeVault, TicketLedger } from "../types";

/**
 * Runs one draw against the live deployment.
 *
 * Separated from the end-to-end script because this is the operator's job,
 * not a participant's: fund the reserve, seal the snapshot, publish the total
 * weight, open, then walk the selection to settlement. Deposits and claims
 * happen in the app.
 *
 * Written to be watchable. Each step prints before it sends, so it can be run
 * beside the interface — or on camera — and the app's draw panel will move
 * through Sealed, Selecting, and Settled as it goes.
 *
 *   npx.cmd hardhat run scripts/run-draw.ts --network sepolia
 */

/** Added to the reserve before sealing, if the reserve is empty. */
const PRIZE = 250n * 10n ** 6n;

/** Positions per transaction. Below the engine's own ceiling. */
const SLICE = 10;

async function main(): Promise<void> {
  await fhevm.initializeCLIApi();

  const [signer] = await ethers.getSigners();
  if (signer === undefined) throw new Error("no signer configured");

  const at = async <T>(name: string, address: string): Promise<T> =>
    (await ethers.getContractAt(name, address, signer)) as unknown as T;

  const ledger = await at<TicketLedger>("TicketLedger", deployment.ledger);
  const vault = await at<PrizeVault>("PrizeVault", deployment.vault);
  const engine = await at<DrawEngine>("DrawEngine", deployment.engine);

  const say = (text: string): void => {
    process.stdout.write(`  ${text}\n`);
  };

  process.stdout.write("\n");

  const participants = await ledger.participantCount();
  if (participants === 0n) {
    say("Nobody has deposited yet — there is nothing to draw for.");
    say("Deposit from the app first, then run this again.");
    return;
  }
  say(`${participants} position(s) in the pool`);

  // ── Prize ───────────────────────────────────────────────────────────────

  let reserve = await vault.unallocatedPrize();
  if (reserve === 0n) {
    say(`Reserve is empty; funding ${PRIZE}`);
    await (await vault.fundPrize(PRIZE)).wait();
    reserve = await vault.unallocatedPrize();
  }
  say(`prize reserve ${reserve}`);

  // ── Seal ────────────────────────────────────────────────────────────────

  say("");
  say("Sealing the snapshot");
  await (await engine.seal()).wait();
  const drawId = await engine.currentDrawId();
  say(`draw ${drawId} sealed over ${await ledger.sealedCount(drawId)} position(s)`);

  // ── Publish total weight ────────────────────────────────────────────────

  say("");
  say("Publishing total weight");
  const handle = await ledger.sealedTotalWeight(drawId);
  const decrypted = await fhevm.publicDecrypt([handle]);
  const clearValues = decrypted.clearValues as Record<string, string | number | bigint>;
  const key = Object.keys(clearValues).find(
    (candidate) => candidate.toLowerCase() === handle.toLowerCase(),
  );
  if (key === undefined) throw new Error("the relayer returned no total weight");

  const totalWeight = BigInt(clearValues[key]!);
  await (
    await engine.publishTotalWeight(drawId, totalWeight, decrypted.decryptionProof)
  ).wait();
  say(`total weight ${totalWeight}`);

  // ── Open ────────────────────────────────────────────────────────────────

  say("");
  say("Opening — the draw point is generated here, encrypted");
  await (await engine.open(drawId)).wait();
  say("nobody can read it, including this script");

  // ── Walk ────────────────────────────────────────────────────────────────

  say("");
  say("Walking the selection over encrypted weights");

  let slices = 0;
  while ((await engine.stateOf(drawId)) !== 3n) {
    const receipt = await (await engine.advance(drawId, SLICE)).wait();
    slices += 1;

    const facts = await engine.drawFacts(drawId);
    const tier = Number(facts[4]) + 1;
    const cursor = Number(facts[5]);
    say(
      `slice ${slices} — tier ${tier}/${facts[6]}, position ${cursor}/${facts[3]}, ` +
        `${receipt?.gasUsed.toLocaleString()} gas`,
    );

    if (slices > 100) throw new Error("draw is not converging");
  }

  say("");
  say(`Settled in ${slices} transaction(s).`);
  say("Awards are credited. Reveal and claim from the app.");
  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
