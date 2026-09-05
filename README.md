# URNA

A no-loss prize savings pool where deposits, odds, and winnings stay encrypted, and winner selection runs on-chain over encrypted balances.

Built on the [Zama Protocol](https://www.zama.org) for **Developer Program Mainnet Season 4**.

**Live app:** _(pending)_
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
| `ConfidentialPrizePool` | [`0x6787cd0dEa7A2705b5240AF5fc92D5688F3d8053`](https://sepolia.etherscan.io/address/0x6787cd0dEa7A2705b5240AF5fc92D5688F3d8053) | Deposits, withdrawals, encrypted balances |
| `TicketLedger` | [`0x2d6A3911714b27344827a981a13a6e3A72b7b1B6`](https://sepolia.etherscan.io/address/0x2d6A3911714b27344827a981a13a6e3A72b7b1B6) | Weight register, O(1) seal, copy-on-write |
| `DrawEngine` | [`0x37E36cb34E9E6Ae2dd151FC60E1d022ebfAF15F8`](https://sepolia.etherscan.io/address/0x37E36cb34E9E6Ae2dd151FC60E1d022ebfAF15F8) | Batched selection over encrypted weights |
| `PrizeVault` | [`0xF26aFc4E2A2cD1b68aCA1fb189D9C71f389D80F2`](https://sepolia.etherscan.io/address/0xF26aFc4E2A2cD1b68aCA1fb189D9C71f389D80F2) | Prize custody, awards, claims |
| `FheRandomEntropy` | [`0x8bad0Fd1F5A87E44C85eF9bbA8158312f45a539A`](https://sepolia.etherscan.io/address/0x8bad0Fd1F5A87E44C85eF9bbA8158312f45a539A) | FHE.randEuint64, never decrypted |
| `TieredWeightPolicy` | [`0x62Ff582C705Ced87871B0946220827Dd16fcf025`](https://sepolia.etherscan.io/address/0x62Ff582C705Ced87871B0946220827Dd16fcf025) | Weight, plus the confidential tier bonus |
| `DisclosureRegistry` | [`0xd750E54E032e91a0365f539e36018D452A20b95a`](https://sepolia.etherscan.io/address/0xd750E54E032e91a0365f539e36018D452A20b95a) | Who may read a settled award |
| `SimulatedYieldSource` | [`0xC98b27c6a8A447615d51fFd348238b31Ae2AB1d9`](https://sepolia.etherscan.io/address/0xC98b27c6a8A447615d51fFd348238b31Ae2AB1d9) | Modelled venue |
| `ConfidentialTokenMock` | [`0x3C26B14e6832fb40e8ACBEb1a5b7e2C1D7dD90Ad`](https://sepolia.etherscan.io/address/0x3C26B14e6832fb40e8ACBEb1a5b7e2C1D7dD90Ad) | Test asset, open minting |

### A draw that actually ran

Draw 2 settled over 13 positions against the live coprocessors. Every step below is on-chain and clickable.

| | |
|---|---|
| Positions | 13 |
| Deposits, public total | 80,100 cUSD |
| Draw weight | 116,000 |
| Prize | 4,000 cUSD, split 50 / 30 / 20 across three tiers |
| Selection | 6 transactions |

The twelve deposits were deliberately uneven and straddle the tier threshold. They sum to the 80,100 published above, while the draw weight is 116,000. **That gap is the tier bonus, and it is the one number on this page worth staring at.** Six positions sit at or above an encrypted threshold and carry 1.5x, so the excess is exactly half of what those six hold — and neither public figure says which six they are.

| Step | Transaction | Gas |
|---|---|---|
| A deposit, encrypted in the browser before it was sent | [0x9faea3fb…d8ba83](https://sepolia.etherscan.io/tx/0x9faea3fbc26893c034668a60a42b6f7466660a5e43a10840a001bd177ed8ba83) | 955,204 |
| Publishing the pool's total, checked against KMS signatures | [0xbfd852c3…6622ff](https://sepolia.etherscan.io/tx/0xbfd852c36561bec1e19789cac43c90869b878c2d84ce61a6a5f0929c8d6622ff) | 410,901 |
| Sealing the snapshot — O(1), whatever its size | [0xf30ce175…da6490](https://sepolia.etherscan.io/tx/0xf30ce175d61d48330dbd678a83cfd741560fb65b35c9ac36a3351c1303da6490) | 181,951 |
| Opening: the draw point is generated here, and never decrypted | [0xc77017dd…a288e6](https://sepolia.etherscan.io/tx/0xc77017dd7680520cd95871773fc55157099bcd4cf0b089b729d2984b93a288e6) | 333,991 |
| The selection walk, first of 6 slices | [0x95e7b033…e92e8e](https://sepolia.etherscan.io/tx/0x95e7b033ce56b539baaa4e4c1635c0f831aada3b16ea9bbd97102ca77de92e8e) | 2,535,424 |
| A winner opening their own award | [0x9384cded…20c01a](https://sepolia.etherscan.io/tx/0x9384cdedfae2606a2a33aab23923e8d4e78cc2f09bd7e87bf268222b5d20c01a) | 90,543 |

Three accounts were paid, one per tier, and their awards sum to exactly the prize. Only one chose to be seen: [`0x8a53…c41D`](https://sepolia.etherscan.io/address/0x8a53BFBc206878bA91420Ea00e867D3fDdFCc41D) at 800 cUSD, now publicly verifiable through the `DisclosureRegistry`. The other two awards sit on-chain and unreadable — by onlookers, by the operator, and by us.

One of the 13 positions is an account emptied by an earlier run. It carries zero weight and can never win, and it is still listed because the participant list only grows — see [Known limits](#known-limits).

`ConfidentialTokenMock` mints on request, so a reviewer can fund themselves and run the whole cycle without asking anyone for an asset.

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
npm test                    # 31 tests
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

The frontend:

```bash
cd frontend && npm install && npm run dev
```

`/preview` renders every panel in every state with no wallet and no chain — useful for design review and for recording a demo without depending on a testnet.

---

## Stack

`@fhevm/solidity` 0.11.1 · `@openzeppelin/confidential-contracts` 0.5.3 (ERC-7984) · Hardhat 2 · Solidity 0.8.27 · Next.js 15

Licensed BSD-3-Clause-Clear.
