<p align="center">
  <img src="docs/urna.png" alt="URNA" width="300">
</p>

A no-loss prize savings pool where deposits, odds, and winnings stay encrypted, and winner selection runs on-chain over encrypted balances.

Built on the [Zama Protocol](https://www.zama.org) for **Developer Program Mainnet Season 4**.

**Live app:** <https://urna-kappa.vercel.app>
**Network:** Sepolia — [contract addresses below](#on-sepolia)

> URNA takes its name from the Romanian *urna*, inherited unchanged from the Latin: the vessel a lot is drawn from. The name is the mechanism. You reach in without seeing what is inside, and the vessel is opaque by construction — not a limitation of the thing, but the definition of it.

---

## What it does

Participants deposit a confidential token into a shared pool. At each draw, an accrued prize is awarded to depositors selected in proportion to their deposit — exactly the PoolTogether mechanic. Nobody loses principal: it is withdrawable at any time, including while a draw is running.

What no existing prize pool can do: **nobody can see who deposited how much, whose odds are better, or who won.** Not other participants, not observers, not the operator.

---

## On Sepolia

Deployed and exercised end to end against the real coprocessors, not only in mock mode.

| Contract | Address | Role |
|---|---|---|
| `ConfidentialPrizePool` | [`0x17546d9d321F50B570e09014008E2187d3bf58a0`](https://sepolia.etherscan.io/address/0x17546d9d321F50B570e09014008E2187d3bf58a0) | Deposits, withdrawals, encrypted balances |
| `TicketLedger` | [`0x8caB02ad0Bfc5016CccFf3f844F304F094ccF767`](https://sepolia.etherscan.io/address/0x8caB02ad0Bfc5016CccFf3f844F304F094ccF767) | Weight register, O(1) seal, copy-on-write |
| `DrawEngine` | [`0xB388c83F2fFc8251C3F6340616600B9f83976cE7`](https://sepolia.etherscan.io/address/0xB388c83F2fFc8251C3F6340616600B9f83976cE7) | Batched selection over encrypted weights |
| `PrizeVault` | [`0xC540214A657d8D7CE20a6E3A4966CA0fFf2D571d`](https://sepolia.etherscan.io/address/0xC540214A657d8D7CE20a6E3A4966CA0fFf2D571d) | Prize custody, awards, claims |
| `FheRandomEntropy` | [`0xA275dcB38827ff45B2894B05AcAcBFdE7Af54D03`](https://sepolia.etherscan.io/address/0xA275dcB38827ff45B2894B05AcAcBFdE7Af54D03) | FHE.randEuint64, never decrypted |
| `TieredWeightPolicy` | [`0x2024292b6dD5C5374Fe921287cBa3F9911e88B20`](https://sepolia.etherscan.io/address/0x2024292b6dD5C5374Fe921287cBa3F9911e88B20) | Weight, plus the confidential tier bonus |
| `DisclosureRegistry` | [`0xd98db1581FF1d82f65f8b53DA517Ea3438233416`](https://sepolia.etherscan.io/address/0xd98db1581FF1d82f65f8b53DA517Ea3438233416) | Who may read a settled award |
| `SimulatedYieldSource` | [`0xbF53ae0364ce1899d3200211B57e45B1DE67fD4c`](https://sepolia.etherscan.io/address/0xbF53ae0364ce1899d3200211B57e45B1DE67fD4c) | Modelled venue |
| `ConfidentialTokenMock` | [`0xc5f14c03f5de8eB4687279079a9136DcFA323115`](https://sepolia.etherscan.io/address/0xc5f14c03f5de8eB4687279079a9136DcFA323115) | Test asset, open minting |

### A draw that actually ran

Draw 1 settled over 12 positions against the live coprocessors. Every step below is on-chain and clickable.

| | |
|---|---|
| Positions | 12 |
| Deposits, public total | 80,100 cUSD |
| Draw weight | 116,000 |
| Prize | 4,000 cUSD, split 50 / 30 / 20 across three tiers |
| Selection | 6 transactions |

The deposits were deliberately uneven and straddle the tier threshold. They sum to the 80,100 published above, while the draw weight is 116,000. **That gap is the one number here worth staring at.** Positions at or above an encrypted threshold carry 1.5x, so the extra 35,900 is exactly half of what those positions hold — and neither public figure says which positions they are.

| Step | Transaction | Gas |
|---|---|---|
| A deposit, encrypted in the browser before it was sent | [0xab065c2d…6a9b75](https://sepolia.etherscan.io/tx/0xab065c2d19c1857145d8e562d558daec055478958c65a55b497cf7032d6a9b75) | 947,029 |
| Publishing the pool's total, checked against KMS signatures | [0x9b874856…badbe8](https://sepolia.etherscan.io/tx/0x9b874856f45a5a5bf6484734aafa4e065298c550d82e735b3edfec610cbadbe8) | 393,813 |
| Sealing the snapshot — O(1), whatever its size | [0xa1551a95…7d4b72](https://sepolia.etherscan.io/tx/0xa1551a95787b7c970b0ffc3606b07e9faf88e5ccc75be43e1e71fc28e37d4b72) | 217,230 |
| Opening: the draw point is generated here, and never decrypted | [0x1f9718bf…d88c89](https://sepolia.etherscan.io/tx/0x1f9718bf3226f72631556d4f6fd49b132342a52e3ab3b0249b1ebd446cd88c89) | 334,002 |
| The selection walk, first of 6 slices | [0xec7e6dca…99266a](https://sepolia.etherscan.io/tx/0xec7e6dca88ae021a05fd4671d780345474ae2a3ba11662db2eb569e6ca99266a) | 2,535,424 |
| A winner opening their own award | [0x2161fdf0…8e386b](https://sepolia.etherscan.io/tx/0x2161fdf0ae6ec4360b8a89330def2f66b8160020038a70c2c3feb40b898e386b) | 90,543 |
| A winner claiming, and the tokens moving | [0xad3c01af…2aa136](https://sepolia.etherscan.io/tx/0xad3c01af58ac20632fc5a353cdb4c5784225639ebded39a7d7baa465322aa136) | 396,398 |

3 accounts were paid, one per tier, and their awards sum to exactly the prize. Only one chose to be seen: [`0x8a53…c41D`](https://sepolia.etherscan.io/address/0x8a53BFBc206878bA91420Ea00e867D3fDdFCc41D) at 1,200 cUSD, now publicly verifiable through the `DisclosureRegistry`. The other awards sit on-chain and unreadable — by onlookers, by the operator, and by us.

The last row is the one worth checking. `0x8a53…c41D` held 0 of the token before claiming and 1,200 after — the award, in full, moved by `confidentialTransfer`. A prize here is money rather than a figure the interface reports.

`ConfidentialTokenMock` mints on request, so a reviewer can fund themselves and run the whole cycle without asking anyone for an asset.

---

## Try it

1. **Connect** a wallet on Sepolia.
2. **Mint test tokens** — the app has a faucet; one click mints cUSD and approves the pool.
3. **Deposit** any amount. The amount is encrypted in your browser before it is sent.
4. **Reveal your balance** — an EIP-712 signature decrypts it locally. Your odds stay sealed even then, deliberately (see below).
5. **Run a draw** — the draw panel offers whatever step is next: seal, publish the snapshot's weight, open, then advance the walk in slices. None of it needs the operator.
6. **Claim** if you won — the prize is transferred to you confidentially — and **withdraw** your principal whenever you like.

---

## Confidentiality design

### What stays encrypted

| Encrypted | Public |
|---|---|
| Every deposit amount | The pool's total principal |
| Every account balance | The snapshot's total draw weight |
| Every account's odds | The prize, and each tier's share |
| Tier membership, and the tier threshold itself | Number of participants |
| **The random draw point** | Which addresses participate |
| Every award amount | That a draw settled |

### What leaks, stated plainly

Three aggregates are public, and each is public for a reason rather than by omission.

**Total principal.** A yield venue holds real assets and knows how much it holds; no amount of encryption on this side changes that. Publishing it is honest rather than pretending otherwise. An aggregate says nothing about its parts: a pool holding 1,000,000 tells you nothing about who holds what.

**Total draw weight.** Needed to map the random value into the weight line. It also makes the pool's size auditable.

**Participation.** Addresses that deposit are visible, because transactions are. Amounts are not.

**One aggregate is safe; a stream of them is not.** This was very nearly the hole in the whole design. The total changes on every deposit and withdrawal, and `Deposited` names the account that moved — so an observer who took a reading immediately before and immediately after a chosen deposit recovered it exactly, by subtraction. Nothing cryptographic failed in that: the ciphertexts held and the KMS proof was real. What failed was letting anyone ask for a reading whenever they liked.

`requestPrincipalDisclosure` is therefore rate-limited: at most one new snapshot per hour, enforced on-chain. The point is to take away the *aiming*. A reading can no longer be placed around a transaction, so a difference now reveals the pool's net change over an hour rather than one account's deposit.

It is still rate-limited rather than restricted, and that is the deliberate choice. Making it owner-only would have closed the window for everyone except the single party with the best view of who is depositing. The gate is **how often**, not **by whom** — the guarantee is meant to hold against this pool's operator too.

The residue is stated rather than papered over: if one account is the only one to move in a whole interval, that hour's net change is its amount. That much is inherent in publishing a total at all, and no arrangement of this feature removes it.

What is *not* leaked is the thing that matters: the mapping from any of those aggregates to an individual position.

### Seeing the confidentiality

Confidentiality has a presentation problem: **it looks exactly like the absence of a feature.** A pool that hides balances and a pool that has no balances render identically, so the work that makes the first one possible is invisible in the thing it produces.

The app has a switch — **You / Anyone else** — that renders the same page from both vantage points. Same data, same components, two points of view:

```
        YOU                            ANYONE ELSE
Balance      12,500.00 cUSD    Balance      ▨▨▨▨▨▨▨▨
Your odds    🔒 sealed          Your odds    ▨▨▨▨▨▨
Award        60,156.00 cUSD    Award        ▨▨▨▨▨▨▨▨
                               Total pool   4,812,500.00   ← what an
                               Participants 47              ← onlooker does see
```

It changes nothing on-chain and reads nothing new; it is purely a rendering. But it makes the guarantee legible in about two seconds, and it is honest in both directions — the observer view also shows exactly what *is* public, rather than implying the pool hides more than it does.

An award that its holder has disclosed shows its real figure even to an onlooker. That is the point of disclosing it.

### Why odds are never shown

The app could compute your odds — it has your revealed balance and the public total. It does not, and this is the one place the interface deliberately refuses to display something it could.

Putting that number on screen *is* the leak. Anyone glancing at the display learns the size of your position. It is withheld because showing it would undo what the protocol protects, not because it is unavailable.

---

## Winner selection

### The mechanism

Selection is an interval lookup. Lay every position end to end on a line of length `totalWeight`; pick a point on that line; whoever owns the interval containing it wins. Weight comes from the deposit, so odds are proportional to it.

On plaintext data you walk until you pass the point, then stop. **Encrypted data forbids the stopping** — the contract may not learn which entry matched, so it cannot branch and cannot exit early. Every entry is visited, and an encrypted flag suppresses matches after the first:

```solidity
prefix   = FHE.add(prefix, weight);          // running prefix sum
hit      = FHE.gt(prefix, drawPoint);        // drawPoint is a ciphertext
isWinner = FHE.and(hit, FHE.not(found));     // only the first hit counts
found    = FHE.or(found, hit);
credit   = FHE.select(isWinner, prize, zero);
```

Cost is identical for every position regardless of where the winner sits, so the traversal leaks nothing — not through gas, not through timing, not through which storage slots are touched. Every participant is credited on every tier; the winner gets the prize, everyone else an encrypted zero, and the vault cannot tell them apart.

### The randomness

The draw point comes from `FHE.randEuint64()` — the protocol's own generator, on-chain, encrypted from the moment it exists:

```solidity
euint64 raw = FHE.randEuint64();
point = FHE.rem(raw, totalWeight);           // scalar divisor: the public total
```

**No off-chain RNG, no seed, no reveal step.** There is no secret anyone holds, so there is nobody who knows the outcome early or can decline to publish one they dislike. The point is never decrypted — not for the operator, not for the app. `Randomness.test.ts` asserts exactly that: both decryption paths must fail.

A commit-reveal scheme was implemented first and then removed. It needs a secret generated off-chain, and whoever holds it knows the result before anyone else and can stall a draw by withholding it. `FHE.randEuint64` has no such holder.

### The one imperfection

Reducing a uniform 64-bit value modulo `totalWeight` is very slightly biased toward low residues, bounded by `totalWeight / 2^64`. For a pool holding a trillion base units that is about one part in ten million.

Removing it would need rejection sampling, which encrypted execution cannot branch on — the loop would run a fixed number of times and select among results, paying full cost for every unused draw. That is a large permanent cost against a bias nobody can measure, so the bias stays and is documented instead.

---

## The yield source

`SimulatedYieldSource` accrues simple interest at a fixed APY against elapsed time. It is a **model of** a lending venue, not a connection to one, and is named accordingly.

Because yield accrues against wall-clock time, a pool earning a few percent a year has produced nothing worth drawing for by the time anyone is watching a demo. `PrizeVault.fundPrize` therefore lets the operator seed the reserve directly — an admin-funded prize reserve, which the brief permits explicitly.

Note the direction: `fundPrize` can only **add**. There is no path that takes value out of the vault, so an operator can subsidise a draw and can never drain one.

**The reserve is tokens, not a tally.** `fundPrize` transfers the asset into the vault and `claim` transfers it out again with `confidentialTransfer`, so a prize the interface displays is a prize the vault can actually pay. Every participant of a draw holds an award — the tier prize for the winner, an encrypted zero for everyone else — which makes a losing claim succeed, move nothing, and look from outside exactly like a winning one.

**The model runs at 0% APY on this deployment.** `SimulatedYieldSource` computes returns arithmetically and holds no tokens, so anything it accrued would swell the reserve with money nothing stands behind, and a draw would announce a prize larger than the vault could pay. Switching it off keeps every figure backed. The model stays in the tree and stays tested; a real adapter is what would turn it back on, because a real venue returns assets rather than arithmetic.

**Plugging in a real source** means implementing `IYieldSource` — `depositPrincipal`, `withdrawPrincipal`, `harvest`, `pendingYield`, `totalPrincipal` — and passing it to the vault and pool at deployment. Behind that interface the pool cannot tell the difference. A Morpho or Aave adapter would live in `contracts/adapters/` beside the simulated one. The one invariant any implementation must hold: **harvesting must never touch principal**, or the pool stops being no-loss.

### Why a public venue does not break confidentiality

The obvious objection to plugging in Aave or Morpho is that they are public markets: whatever the pool deposits there is visible to everyone. It is visible, and it does not matter, because what goes in is the aggregate this protocol already publishes.

Look at which direction the interface points. `publishPrincipal` takes a cleartext total, checks it against KMS signatures for the pool's own handle, and hands the yield source only the *difference*:

```solidity
if (cleartextTotal > previous) {
    yieldSource.depositPrincipal(cleartextTotal - previous);
} else {
    yieldSource.withdrawPrincipal(previous - cleartextTotal);
}
```

Individual deposits never reach the venue, and no adapter is ever handed a ciphertext. The venue sees a single depositor holding a single balance — the pool — and has no way to see inside it. The confidentiality boundary sits at the pool, not at the adapter, which is why `IYieldSource` speaks entirely in plaintext totals.

That is also the honest reason a simulated source was enough to build against. `IYieldSource` is not a placeholder shape chosen to make testing easy; it is the shape a real venue actually needs, and it was arrived at by asking what could safely cross the boundary rather than by wrapping whichever API happened to be at hand.

---

## The constraint that shaped the architecture

fhEVM caps each transaction at **20,000,000 HCU globally** and **5,000,000 HCU of sequential depth**. The second binds here.

The prefix chain is strictly sequential — entry `i` cannot be added before `i-1` — and each link costs 162,000 HCU, putting the ceiling near 28 positions per transaction. Real gas binds sooner still: a Sepolia deposit costs ~947k gas for a handful of homomorphic operations.

So the walk **checkpoints**. Each `advance` restores the encrypted `prefix` and `found` from storage, consumes a bounded slice, and writes them back. This is a protocol constraint, not a tuning choice: an engine that tries to settle a realistic pool atomically works against three test accounts and reverts in production.

Two consequences worth naming:

- **Depth is not the sum of per-entry cost.** The prefix chain and the found-flag chain advance in parallel. Estimating depth by adding up everything each entry costs understates the safe batch by roughly 3x. `simulation/hcu` models this as a dependency graph and takes the longest path.
- **Sealing is O(1).** Draw weight is derived when a balance moves, not when a draw opens, so the account causing the change pays for it. A snapshot survives later withdrawals through copy-on-write: only accounts that actually move pay to preserve their frozen weight.

`maxSlice` is a configurable parameter rather than a constant, because the two costs that bind it can only be measured against a live deployment.

---

## Verification

Three layers, each answering a different question.

**Is the algorithm fair?** `simulation/reference` implements the same selection on plaintext, and `npm run simulate:fairness` checks it **exhaustively**: for small pools it walks every draw point in `[0, totalWeight)` and confirms each account wins exactly as many points as it holds weight. A proof over the whole domain, not a sample — it catches the off-by-one boundary errors a Monte Carlo run would bury inside its tolerance.

**Does the contract compute the same thing?** `test/DrawEquivalence.test.ts` runs draws against `FixedPointEntropy`, which pins the draw point so the expected winner is known, and asserts the chain agrees with the model — including at every interval boundary.

**Is the randomness real?** `test/Randomness.test.ts` runs the production source, where the point is unknowable by design, and checks what remains checkable: exactly one position paid per tier, an independent point per tier, outcomes that vary across draws, and a draw point neither the public nor the operator can decrypt.

```bash
npm run simulate:fairness   # 23 checks, exhaustive fairness
npm run simulate:hcu        # 8 checks, batch budget
npm test                    # 35 tests
npm run typecheck
```

---

## Architecture

```
contracts/
├── core/
│   ├── ConfidentialPrizePool.sol   deposits, withdrawals, confidential balances
│   ├── TicketLedger.sol            weight register, O(1) seal, copy-on-write
│   ├── DrawEngine.sol              batched selection over encrypted weights
│   └── PrizeVault.sol              prize custody, awards, claims
├── policies/
│   ├── LinearWeightPolicy.sol      weight = balance
│   └── TieredWeightPolicy.sol      + confidential tier bonus
├── disclosure/
│   └── DisclosureRegistry.sol      who may read a settled award
├── entropy/
│   └── FheRandomEntropy.sol        FHE.randEuint64, never decrypted
├── adapters/
│   └── SimulatedYieldSource.sol    modelled venue
├── mocks/                          test token, fixed-point entropy
└── interfaces/
```

### Draw lifecycle

```
Open ──seal()──> Sealed ──open()──> Selecting ──advance()×k──> Settled
                    │                                             │
        publishTotalWeight()                              ledger released,
                                                          next draw can seal
```

`advance` is permissionless: the outcome is already fixed by the sealed snapshot and the drawn point, so there is nothing for a caller to influence, and a draw cannot stall because one keeper went offline.

`seal` is permissionless too, on a cadence: anyone may start a draw once `DRAW_INTERVAL` has passed since the last one. That is the whole of the automation story — there is no privileged keeper to go offline, and `scripts/keeper.ts` is simply one program willing to be the caller.

The interval is five minutes on this deployment so a reviewer can run a full cycle in one sitting. A pool holding real savings would draw daily, and the interval is the only line that would change.

### Selective disclosure

An award starts readable by exactly one account — its winner. Not the operator, not the vault, not the protocol:

```solidity
FHE.allow(amount, winner);                   // default: winner only
FHE.makePubliclyDecryptable(amount);         // only the winner can trigger this
```

A winner who wants to prove a payout can open their own award. **The pool can never open it for them.** Disclosure is one-way, and the registry refuses a second attempt so the event log stays an accurate record.

---

## What reviewing our own code turned up

Four of these were found by reading the code after it worked, which is the only time anyone finds this kind of thing. They are written out because a reviewer who finds them unaided learns something worse than the bug: that we did not look.

### The pool's total could be differenced

**What it was.** `requestPrincipalDisclosure` was permissionless and unlimited, while the encrypted total changes on every deposit and withdrawal. `Deposited` names the account that moved. So anyone could take a reading immediately before and immediately after a chosen deposit, decrypt both totals through the relayer, and subtract — recovering that deposit exactly.

Nothing cryptographic failed. The ciphertexts held; the KMS proof was real. What failed was letting anyone ask for a reading whenever they liked, which is a question about permissions wearing a cryptography costume.

**The fix.** One new snapshot per hour, enforced on-chain. The interval takes away the *aiming*: a reading can no longer be placed around a transaction, so a difference reveals the pool's net change over an hour instead of one account's deposit.

Rate-limited rather than restricted, deliberately. Owner-only would have closed the window for everyone except the single party with the best view of who is depositing.

**What remains.** If one account is the only one to move in a whole interval, that hour's net change is its amount. Inherent in publishing a total at all. Four tests cover the attack, including one that performs it.

### Prizes were never actually paid

**What it was.** `PrizeVault.claim` flipped a bool, re-granted a read permission, and emitted an event. It moved no tokens. `fundPrize` incremented a counter without pulling any. The vault held no reference to the asset at all, so it could not have paid anyone even in principle.

Deposits were real, withdrawals were real, principal was safe — and a winner received a number.

The tell was in the vault's own documentation, which already described the behaviour it did not have: *"a losing claim succeeds and transfers nothing"*. The design was right and the implementation had quietly stopped short of it.

**The fix.** The vault holds the asset. `fundPrize` moves tokens in; `claim` moves them out with `confidentialTransfer`. A loser holds an encrypted zero, so their claim succeeds and transfers nothing — one transaction of the same shape against the same token, exactly as the comment always claimed. Two tests: the winner's own balance grows by the prize, and a loser's does not move.

### Modelled yield was money that did not exist

**What it was.** Following the previous fix: `SimulatedYieldSource` computes returns arithmetically and holds no tokens, but `harvest` still added its output to the prize reserve. A draw could therefore announce a prize larger than the vault could pay.

**The fix.** The deployed pool runs the model at 0% APY, and the reserve is funded by the operator in real tokens — which the brief permits explicitly. The model stays in the tree, still tested, still the thing a real adapter replaces. What is switched off is only its contribution to money that has to exist.

### Depth is not the sum of per-entry cost

Not a defect, but a mismeasurement that would have shipped as one. Estimating a batch by adding up what each entry costs gave a safe slice of 8 positions. The real constraint is the *longest dependent chain*, and the prefix-sum chain and the found-flag chain advance in parallel — so the true ceiling was 28, and we were leaving three quarters of each transaction unused.

`simulation/hcu` now models the batch as a dependency graph and takes the longest path. Measured against a live deployment: 3,344,080 HCU global and 1,528,032 depth, against a model predicting 4,360,048 and 1,655,000 — conservative in both directions, which is the direction an estimate should be wrong in.

### A refund that ran out of gas

Small, and included because it is the kind of thing that only shows up against a real chain. The seeding script returned unspent testnet ether to the operator with `gasLimit: 21_000`, the cost of a transfer to a plain account. The operator's account is delegated under EIP-7702 — its code is an `0xef0100` designator pointing at a smart-account implementation — so paying it runs code, and the chain estimates 21,220. The transfer reverted with the gas exhausted, after the deposit it was cleaning up behind had already succeeded.

Nothing on a local network would have caught it.

---

## Known limits

- **A quiet hour still leaks.** Snapshots of the pool's total are rate-limited so they cannot be taken either side of a chosen deposit, but if one account is the only one to move during a whole interval, the difference between two readings is that account's amount. Inherent in publishing a total at all; see [What leaks, stated plainly](#what-leaks-stated-plainly).
- **The yield source is modelled, not connected.** See above for how a real one plugs in.
- **The participant list only grows.** Traversal order is load-bearing across a batched walk, so compaction is only safe while no draw is sealed, and this version does not attempt it. An account that withdraws everything stays in the list carrying zero weight — one storage read per draw, and it can never win.
- **The same account can win several tiers of one draw.** Excluding prior winners would require knowing who they are.
- **The tier threshold must be set before the first deposit.** It is a ciphertext, so it comes through the SDK rather than a constructor.
- **Unaudited.** Testnet only.

---

## Running it

```bash
npm install
npm run compile
npm test
```

Deploying — needs `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` in `.env` (see `.env.example`):

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

Addresses are written to `deployments/<chainId>.json` and into the frontend config automatically. Then set the tier threshold and exercise the full cycle:

```bash
npx hardhat run scripts/e2e-sepolia.ts --network sepolia
```

Draws need nobody in particular. To have them run on their own:

```bash
npx hardhat run scripts/keeper.ts --network sepolia
```

It seals when the cadence allows, publishes the snapshot's weight, opens, and walks the selection to settlement, then waits for the next slot. Every call it makes is one anyone could make, so it holds no authority the pool depends on — stop it and someone else's copy carries on. `scripts/run-draw.ts` runs a single draw instead, which is easier to narrate on camera.

The frontend:

```bash
cd frontend && npm install && npm run dev
```

`/preview` renders every panel in every state with no wallet and no chain — useful for design review and for recording a demo without depending on a testnet.

---

## Stack

`@fhevm/solidity` 0.11.1 · `@openzeppelin/confidential-contracts` 0.5.3 (ERC-7984) · Hardhat 2 · Solidity 0.8.27 · Next.js 15

Licensed BSD-3-Clause-Clear.
