# Urna

A no-loss prize savings pool where deposits, odds, and winnings stay encrypted, and winner selection runs on-chain over encrypted balances.

Built on the [Zama Protocol](https://www.zama.org) for **Developer Program Mainnet Season 4**.

**Live app:** _(pending)_
**Network:** Sepolia — addresses in [`deployments/11155111.json`](deployments/11155111.json)

> *Urna* is Romanian, inherited unchanged from the Latin: the vessel a lot is drawn from. The name is the mechanism. You reach in without seeing what is inside, and the vessel is opaque by construction — not a limitation of the thing, but the definition of it.

---

## What it does

Participants deposit a confidential token into a shared pool. At each draw, an accrued prize is awarded to depositors selected in proportion to their deposit — exactly the PoolTogether mechanic. Nobody loses principal: it is withdrawable at any time, including while a draw is running.

What no existing prize pool can do: **nobody can see who deposited how much, whose odds are better, or who won.** Not other participants, not observers, not the operator.

---

## Try it

1. **Connect** a wallet on Sepolia.
2. **Mint test tokens** — the app has a faucet; one click mints cUSD and approves the pool.
3. **Deposit** any amount. The amount is encrypted in your browser before it is sent.
4. **Reveal your balance** — an EIP-712 signature decrypts it locally. Your odds stay sealed even then, deliberately (see below).
5. **Watch a draw** — the operator seals, funds a prize, and the selection walk runs in slices.
6. **Claim** if you won, and **withdraw** your principal whenever you like.

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

**Plugging in a real source** means implementing `IYieldSource` — `depositPrincipal`, `withdrawPrincipal`, `harvest`, `pendingYield`, `totalPrincipal` — and passing it to the vault and pool at deployment. Behind that interface the pool cannot tell the difference. A Morpho or Aave adapter would live in `contracts/adapters/` beside the simulated one. The one invariant any implementation must hold: **harvesting must never touch principal**, or the pool stops being no-loss.

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
npm test                    # 27 tests
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

`seal` is operator-triggered. Automating it needs only a keeper calling `seal` then `advance` on a schedule.

### Selective disclosure

An award starts readable by exactly one account — its winner. Not the operator, not the vault, not the protocol:

```solidity
FHE.allow(amount, winner);                   // default: winner only
FHE.makePubliclyDecryptable(amount);         // only the winner can trigger this
```

A winner who wants to prove a payout can open their own award. **The pool can never open it for them.** Disclosure is one-way, and the registry refuses a second attempt so the event log stays an accurate record.

---

## Known limits

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

The frontend:

```bash
cd frontend && npm install && npm run dev
```

`/preview` renders every panel in every state with no wallet and no chain — useful for design review and for recording a demo without depending on a testnet.

---

## Stack

`@fhevm/solidity` 0.11.1 · `@openzeppelin/confidential-contracts` 0.5.3 (ERC-7984) · Hardhat 2 · Solidity 0.8.27 · Next.js 15

Licensed BSD-3-Clause-Clear.
