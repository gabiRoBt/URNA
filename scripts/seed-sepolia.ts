import { ethers, fhevm } from "hardhat";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import deployment from "../deployments/11155111.json";
import type {
  ConfidentialPrizePool,
  ConfidentialTokenMock,
  DisclosureRegistry,
  DrawEngine,
  PrizeVault,
  TicketLedger,
} from "../types";

/**
 * Populates the live deployment, then runs a real draw against it.
 *
 * A pool with one position is not a demonstration of confidentiality — it is
 * a demonstration of nothing. With a single depositor the public total *is*
 * that depositor's balance, the ring of indistinguishable positions has one
 * dot in it, and every claim the interface makes is vacuously true. This
 * script gives the deployment enough participants for those claims to mean
 * something, and leaves a settled draw with a real winner behind it.
 *
 * The accounts are derived from the operator's own key rather than stored, so
 * a second run reproduces the same addresses and skips whatever is already
 * on-chain. Nothing secret is written to disk.
 *
 *   npx.cmd hardhat run scripts/seed-sepolia.ts --network sepolia
 */

const UNIT = 10n ** 6n;
const EUINT64 = 0x05 as never;

/**
 * Deposits, in whole tokens.
 *
 * Deliberately uneven, and deliberately straddling the 5,000 tier threshold —
 * six above, six below. A uniform set would hide both the weight policy and
 * any scaling error in the interface, and would give every position identical
 * odds, which is not what a real pool looks like.
 */
const DEPOSITS = [
  420n,
  1_250n,
  7_500n,
  3_000n,
  12_400n,
  890n,
  22_000n,
  5_600n,
  2_100n,
  15_000n,
  640n,
  9_300n,
];

/** Prize for the seeded draw, in whole tokens. */
const PRIZE = 4_000n * UNIT;

/**
 * Gas an account must be funded for: its own operator approval and deposit,
 * about 1.05M together, with headroom.
 *
 * Sized against the fee *cap*, never against the price actually paid. A
 * transaction is refused at broadcast unless the sender's balance covers
 * `gasLimit × maxFeePerGas`, and ethers sets that cap at roughly twice the
 * base fee — so funding that comfortably covers the real cost is still
 * rejected. That is precisely how the first run of this script died, one
 * transaction in: the account held 0.00245 ETH, spent 0.0012, and was turned
 * away for wanting 0.00258.
 */
const SELF_SENT_GAS = 1_600_000n;

/** Gas for a plain transfer, which is what the refund at the end costs. */
const TRANSFER_GAS = 21_000n;

interface Receipt {
  what: string;
  hash: string;
  gas: string;
}

async function main(): Promise<void> {
  await fhevm.initializeCLIApi();

  const [operator] = await ethers.getSigners();
  if (operator === undefined) throw new Error("no signer configured");

  const at = async <T>(name: string, address: string): Promise<T> =>
    (await ethers.getContractAt(name, address, operator)) as unknown as T;

  const token = await at<ConfidentialTokenMock>("ConfidentialTokenMock", deployment.token);
  const ledger = await at<TicketLedger>("TicketLedger", deployment.ledger);
  const vault = await at<PrizeVault>("PrizeVault", deployment.vault);
  const engine = await at<DrawEngine>("DrawEngine", deployment.engine);
  const pool = await at<ConfidentialPrizePool>("ConfidentialPrizePool", deployment.pool);
  const disclosure = await at<DisclosureRegistry>("DisclosureRegistry", deployment.disclosure);

  const receipts: Receipt[] = [];
  const step = (text: string): void => {
    process.stdout.write(`\n  ${text}\n`);
  };
  const detail = (text: string): void => {
    process.stdout.write(`    ${text}\n`);
  };

  const send = async (
    what: string,
    action: () => Promise<{ hash: string; wait: () => Promise<{ gasUsed: bigint } | null> }>,
    // Moving testnet ether between accounts is plumbing, not protocol. It is
    // shown while the run happens and left out of the record, so the file the
    // README draws from contains only transactions worth looking at.
    record = true,
  ): Promise<void> => {
    const tx = await action();
    const receipt = await tx.wait();
    const gas = receipt?.gasUsed ?? 0n;
    if (record) receipts.push({ what, hash: tx.hash, gas: gas.toString() });
    detail(`${what} — ${gas.toLocaleString()} gas`);
  };

  /**
   * Turns a handle the chain has marked public into a value plus the KMS
   * signatures that prove it. The relayer keys its response by handle, but
   * not always in the same case, so the lookup is deliberately insensitive.
   */
  const publicValue = async (handle: string): Promise<{ value: bigint; proof: string }> => {
    const published = await fhevm.publicDecrypt([handle]);
    const values = published.clearValues as Record<string, string | number | bigint>;
    const key = Object.keys(values).find(
      (candidate) => candidate.toLowerCase() === handle.toLowerCase(),
    );
    if (key === undefined) throw new Error(`relayer returned nothing for ${handle}`);
    return { value: BigInt(values[key]!), proof: published.decryptionProof };
  };

  // ── The seeded accounts ─────────────────────────────────────────────────

  // Derived from the operator's key, so only the operator can reproduce them
  // and a rerun lands on the same addresses. They hold testnet value only.
  const secret = (process.env["DEPLOYER_PRIVATE_KEY"] ?? "").trim();
  if (secret === "") throw new Error("DEPLOYER_PRIVATE_KEY is not set");

  const accounts = DEPOSITS.map((_, index) => {
    const material = ethers.keccak256(
      ethers.solidityPacked(["string", "string", "uint256"], [secret, "urna/seed", index]),
    );
    return new ethers.Wallet(material, ethers.provider);
  });

  // ── Preflight ───────────────────────────────────────────────────────────

  const fee = await ethers.provider.getFeeData();
  const feeCap = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const priority = fee.maxPriorityFeePerGas ?? 0n;
  const opening = await ethers.provider.getBalance(operator.address);

  const funding = feeCap * SELF_SENT_GAS;

  // Accounts are funded one at a time and swept as soon as they have
  // deposited, so only one funding is outstanding at any moment. What the run
  // actually needs is the operator's own gas — a transfer, a mint and a
  // refund per account, plus the draw — with a couple of fundings of slack.
  const estimate =
    funding * 2n + feeCap * (BigInt(accounts.length) * 450_000n + 6_000_000n);

  process.stdout.write("\n");
  detail(`operator      ${operator.address}`);
  detail(`balance       ${ethers.formatEther(opening)} ETH`);
  detail(`gas price     ${ethers.formatUnits(fee.gasPrice ?? 0n, "gwei")} gwei`);
  detail(`fee cap       ${ethers.formatUnits(feeCap, "gwei")} gwei`);
  detail(`accounts      ${accounts.length}`);
  detail(`funding each  ${ethers.formatEther(funding)} ETH, refunded after depositing`);
  detail(`estimated     ${ethers.formatEther(estimate)} ETH`);

  if (opening < estimate) {
    throw new Error(
      `not enough Sepolia ETH: have ${ethers.formatEther(opening)}, ` +
        `need about ${ethers.formatEther(estimate)}`,
    );
  }

  // ── Deposits ────────────────────────────────────────────────────────────

  // Chain time, not wall-clock. A testnet's clock can sit well away from the
  // machine's, and an operator approval dated in the chain's past is refused
  // at the moment it is used rather than at the moment it is set.
  const chainNow = (await ethers.provider.getBlock("latest"))?.timestamp ?? 0;
  const deadline = chainNow + 365 * 24 * 60 * 60;

  for (const [index, account] of accounts.entries()) {
    const amount = DEPOSITS[index]! * UNIT;
    step(`Account ${index + 1}/${accounts.length} — ${account.address}, ${DEPOSITS[index]} cUSD`);

    // Resumable: a position already on-chain is left exactly as it is.
    if ((await pool.balanceOf(account.address)) !== ethers.ZeroHash) {
      detail("already deposited, skipping");
      continue;
    }

    const held = await ethers.provider.getBalance(account.address);
    if (held < funding) {
      await send(
        "fund",
        () => operator.sendTransaction({ to: account.address, value: funding - held }),
        false,
      );
    }

    // An account that already holds an approval was minted to on an earlier
    // run. Redoing either is harmless and neither is free, so both are
    // skipped and the run picks up at the deposit.
    if (!(await token.isOperator(account.address, deployment.pool))) {
      await send("mint", () => token.mint(account.address, amount));
      await send("approve pool", () =>
        token.connect(account).setOperator(deployment.pool, deadline),
      );
    } else {
      detail("already minted and approved, skipping");
    }

    const input = await fhevm
      .createEncryptedInput(deployment.pool, account.address)
      .add64(amount)
      .encrypt();

    await send("deposit", () => pool.connect(account).deposit(input.handles[0]!, input.inputProof));

    // Give back what was not spent. Funding has to be sized against the worst
    // case the network will accept, so most of it comes back; stranding that
    // twelve times over would cost more than the rest of the run.
    const left = await ethers.provider.getBalance(account.address);
    const refund = left - feeCap * TRANSFER_GAS;
    if (refund > 0n) {
      await send(
        "refund",
        () =>
          account.sendTransaction({
            to: operator.address,
            value: refund,
            gasLimit: TRANSFER_GAS,
            maxFeePerGas: feeCap,
            maxPriorityFeePerGas: priority,
          }),
        false,
      );
    }
  }

  detail(`participants now ${await ledger.participantCount()}`);

  // ── Publish the total ───────────────────────────────────────────────────

  step("Publishing the pool's total principal");
  await send("request disclosure", () => pool.requestPrincipalDisclosure());

  const principal = await publicValue(await pool.totalPrincipalHandle());
  await send("publish principal", () => pool.publishPrincipal(principal.value, principal.proof));
  detail(`published ${principal.value}`);

  // ── Prize ───────────────────────────────────────────────────────────────

  if ((await vault.unallocatedPrize()) < PRIZE) {
    step("Funding the prize reserve");
    await send("fund prize", () => vault.fundPrize(PRIZE));
  }

  // ── Draw ────────────────────────────────────────────────────────────────

  step("Sealing a draw");
  await send("seal", () => engine.seal());
  const drawId = await engine.currentDrawId();
  detail(`draw ${drawId}, ${await ledger.sealedCount(drawId)} positions sealed`);

  const weight = await publicValue(await ledger.sealedTotalWeight(drawId));
  await send("publish weight", () => engine.publishTotalWeight(drawId, weight.value, weight.proof));
  detail(`weight ${weight.value} against ${principal.value} deposited — the excess is the tier bonus`);

  step("Opening the draw");
  await send("open", () => engine.open(drawId));

  step("Walking the selection");
  let slices = 0;
  while ((await engine.stateOf(drawId)) !== 3n) {
    slices += 1;
    await send(`advance ${slices}`, () => engine.advance(drawId, 10));
    if (slices > 40) throw new Error("draw did not converge");
  }
  detail(`settled in ${slices} transactions`);

  // ── Winners ─────────────────────────────────────────────────────────────

  // The operator cannot read any of these. Each account decrypts its own
  // award with its own key, which is the only way to learn who won — and is
  // exactly what a participant does in the app.
  step("Reading awards, one account at a time");
  const winners: { address: string; award: bigint }[] = [];

  for (const [index, account] of accounts.entries()) {
    const handle = await vault.awardOf(drawId, account.address);
    if (handle === ethers.ZeroHash) continue;
    const award = await fhevm.userDecryptEuint(EUINT64, handle, deployment.vault, account);
    detail(`account ${index + 1}: ${award === 0n ? "nothing" : award.toString()}`);
    if (award > 0n) winners.push({ address: account.address, award });
  }

  // One award is opened on-chain, so the registry holds a real record of a
  // holder choosing to be seen. The rest stay private, which is the default.
  const opener = winners[0];
  if (opener !== undefined && (await disclosure.visibilityOf(drawId, opener.address)) === 0n) {
    const account = accounts.find((candidate) => candidate.address === opener.address)!;
    step("One winner discloses their award");
    await send("disclose", () => disclosure.connect(account).disclose(drawId));
    detail(`${opener.address} is now publicly verifiable at ${opener.award}`);
  }

  // ── Record ──────────────────────────────────────────────────────────────

  const spent = opening - (await ethers.provider.getBalance(operator.address));
  const record = {
    chainId: 11155111,
    seededAt: new Date().toISOString(),
    drawId: drawId.toString(),
    participants: (await ledger.participantCount()).toString(),
    publishedPrincipal: principal.value.toString(),
    totalWeight: weight.value.toString(),
    prize: PRIZE.toString(),
    slices,
    winners: winners.map((entry) => ({ address: entry.address, award: entry.award.toString() })),
    disclosed: opener?.address ?? null,
    transactions: receipts,
  };

  writeFileSync(
    resolve(__dirname, "../deployments/11155111-seed.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  step("Done");
  detail(`spent ${ethers.formatEther(spent)} ETH`);
  detail(`${receipts.length} transactions recorded in deployments/11155111-seed.json`);
  process.stdout.write("\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
