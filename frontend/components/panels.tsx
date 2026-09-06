/**
 * The interface's panels, as presentational components.
 *
 * Each takes plain data and callbacks — none of them reach for a wallet, a
 * contract, or the SDK. That separation is what lets `/preview` render every
 * state without a chain behind it, which matters both for design work and for
 * recording a demo that does not depend on a testnet being healthy.
 */

"use client";

import { useState } from "react";

import { Button, Group, Meter, Row, Sealed, Stage, Status } from "./primitives";
import { ByVantage, Redacted, type Vantage } from "./ObserverToggle";
import { deployment, TOKEN_SYMBOL } from "@/lib/config";
import { formatAmount, parseAmount } from "@/lib/format";
import {
  DrawState,
  drawProgress,
  type DeploymentFacts,
  type DrawFacts,
} from "@/lib/useProtocol";

/* ── Position ───────────────────────────────────────────────────────── */

export function PositionPanel({
  connected,
  hasPosition,
  handle,
  revealed,
  busy,
  vantage,
  onReveal,
  onHide,
}: {
  connected: boolean;
  hasPosition: boolean;
  /** Handle to the encrypted balance, shown so a reader can see it is one. */
  handle?: string | null;
  revealed: bigint | null;
  busy: string | null;
  vantage: Vantage;
  onReveal: () => void;
  onHide: () => void;
}) {
  if (!connected) {
    return (
      <Group caption="Your position">
        <div className="empty">Connect a wallet to see your position.</div>
      </Group>
    );
  }

  if (!hasPosition) {
    return (
      <Group caption="Your position">
        <div className="empty">No deposit yet.</div>
      </Group>
    );
  }

  const observing = vantage === "observer";

  return (
    <Group
      caption={observing ? "This position, seen by anyone" : "Your position"}
      footnote={
        observing
          ? "An onlooker sees that this address holds a position. Not its size, not its odds, not what it has won."
          : "Your balance and your odds are encrypted on-chain. Revealing decrypts locally in this browser — it does not publish anything."
      }
    >
      <Row
        label="Balance"
        value={
          <ByVantage
            vantage={vantage}
            observer={<Redacted width={104} />}
            holder={
              revealed === null ? (
                <Sealed handle={handle} />
              ) : (
                <span className="amount row-value-strong">{formatAmount(revealed)}</span>
              )
            }
          />
        }
      />
      {/*
        Odds stay sealed in both views, and for different reasons. To an
        onlooker they are simply unavailable. To the holder they are
        computable — balance is revealed, the total is public — and still not
        shown, because rendering that number is itself the leak: anyone
        glancing at the screen would learn the position's size.
      */}
      <Row
        label="Your odds"
        sublabel={observing ? undefined : "Not computed, here or on-chain"}
        value={
          <ByVantage
            vantage={vantage}
            observer={<Redacted width={70} />}
            holder={<Sealed />}
          />
        }
      />
      {!observing && (
        <Row>
          {revealed === null ? (
            <Button full onClick={onReveal} disabled={busy !== null}>
              {busy === "reveal" ? "Decrypting…" : "Reveal balance"}
            </Button>
          ) : (
            <Button full variant="quiet" onClick={onHide}>
              Hide
            </Button>
          )}
        </Row>
      )}
    </Group>
  );
}

/* ── Deposit and withdraw ───────────────────────────────────────────── */

export function MovePanel({
  busy,
  hasPosition,
  approved,
  onApprove,
  onDeposit,
  onWithdraw,
}: {
  busy: string | null;
  hasPosition: boolean;
  /** Whether the pool may move this account's tokens. */
  approved: boolean;
  onApprove: () => void;
  onDeposit: (amount: bigint) => void;
  onWithdraw: (amount: bigint) => void;
}) {
  const [depositText, setDepositText] = useState("");
  const [withdrawText, setWithdrawText] = useState("");

  const depositAmount = parseAmount(depositText);
  const withdrawAmount = parseAmount(withdrawText);

  return (
    <Group
      caption="Move funds"
      footnote="Withdrawals are always available, including while a draw is running. A position sealed into a draw keeps the odds it had when the draw closed."
    >
      {/*
        ERC-7984 has no `approve`; a holder names an operator instead, and the
        pool has to be one before it can move anything. Shown as its own step
        because a deposit that reverts for a missing approval teaches nothing,
        and because this is the step people expect to see and would otherwise
        assume was skipped.
      */}
      <Row
        label="Pool approval"
        sublabel={
          approved
            ? "The pool may move your tokens on your instruction"
            : "ERC-7984 names an operator rather than granting an allowance"
        }
        value={
          approved ? (
            <span className="row-value-positive">Granted</span>
          ) : (
            <Button onClick={onApprove} disabled={busy !== null}>
              {busy === "approve" ? "Working…" : "Approve pool"}
            </Button>
          )
        }
      />
      <Row>
        <div className="field">
          <input
            className="input"
            inputMode="decimal"
            placeholder={`Amount in ${TOKEN_SYMBOL}`}
            value={depositText}
            onChange={(event) => setDepositText(event.target.value)}
            aria-label="Deposit amount"
            disabled={!approved}
          />
          <Button
            variant="primary"
            disabled={depositAmount === null || busy !== null || !approved}
            onClick={() => depositAmount !== null && onDeposit(depositAmount)}
          >
            {busy === "deposit" ? "Working…" : "Deposit"}
          </Button>
        </div>
      </Row>
      <Row>
        <div className="field">
          <input
            className="input"
            inputMode="decimal"
            placeholder={`Amount in ${TOKEN_SYMBOL}`}
            value={withdrawText}
            onChange={(event) => setWithdrawText(event.target.value)}
            aria-label="Withdraw amount"
            disabled={!hasPosition}
          />
          <Button
            disabled={withdrawAmount === null || busy !== null || !hasPosition}
            onClick={() => withdrawAmount !== null && onWithdraw(withdrawAmount)}
          >
            {busy === "withdraw" ? "Working…" : "Withdraw"}
          </Button>
        </div>
      </Row>
    </Group>
  );
}

/* ── Faucet ─────────────────────────────────────────────────────────── */

/**
 * Mints the pool's test token.
 *
 * The token is a mock with open minting, deployed alongside the pool, so
 * anyone can fund themselves and try the full cycle. On a real deployment this
 * panel would not exist — but without it a reviewer has no way to obtain the
 * asset the pool accepts, and the app is unusable to them.
 */
export function FaucetPanel({
  busy,
  amount,
  onMint,
}: {
  busy: string | null;
  amount: bigint;
  onMint: () => void;
}) {
  return (
    <Group
      caption="Test token"
      footnote="A mock confidential token with open minting, for trying the pool on Sepolia. Not a real asset."
    >
      <Row
        label={`Get ${formatAmount(amount)}`}
        sublabel="Minted to your wallet, then approved for the pool"
        value={
          <Button variant="primary" onClick={onMint} disabled={busy !== null}>
            {busy === "faucet" ? "Working…" : "Mint"}
          </Button>
        }
      />
    </Group>
  );
}

/* ── Pool ───────────────────────────────────────────────────────────── */

/**
 * Describes how old the published total is.
 *
 * The figure is allowed to lag on purpose. Snapshots of the encrypted total
 * are rate-limited on-chain, because two of them taken either side of one
 * deposit would differ by exactly that deposit. Saying so under the number
 * turns a defence that looks like a stale page into the thing it is.
 */
function snapshotAge(publishedAt: number): string {
  if (publishedAt === 0) return "Not published yet";

  const minutes = Math.max(0, Math.floor(Date.now() / 1000 - publishedAt) / 60);
  const when =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${Math.floor(minutes)} min ago`
        : `${Math.floor(minutes / 60)} h ago`;

  return `Snapshot taken ${when} — at most one an hour, so it cannot be read around a deposit`;
}

export function PoolPanel({
  principal,
  prize,
  participants,
  publishedAt = 0,
}: {
  principal: bigint;
  prize: bigint;
  participants: number;
  publishedAt?: number;
}) {
  return (
    <Group
      caption="Pool"
      footnote="Aggregates are public because the yield venue holds real assets and knows how much it holds. A total says nothing about who holds what."
    >
      <Row
        label="Total deposits"
        sublabel={snapshotAge(publishedAt)}
        value={<span className="amount">{formatAmount(principal)}</span>}
      />
      <Row
        label="Prize accruing"
        value={<span className="amount">{formatAmount(prize)}</span>}
      />
      <Row label="Participants" value={<span className="mono">{participants}</span>} />
    </Group>
  );
}

/* ── Rules ──────────────────────────────────────────────────────────── */

/**
 * What this deployment was built with, read from this deployment.
 *
 * Everything here is also written in the README, and a README is a claim. The
 * point of the panel is that these are not claims: they come from the
 * bytecode a reviewer is about to put money into, and disagreeing with the
 * document would be visible in two seconds.
 */
export function RulesPanel({ facts }: { facts: DeploymentFacts | null }) {
  if (facts === null) return null;

  const minutes = (seconds: number): string =>
    seconds % 3600 === 0
      ? `${seconds / 3600} h`
      : seconds % 60 === 0
        ? `${seconds / 60} min`
        : `${seconds} s`;

  return (
    <Group
      caption="Rules, read from the contracts"
      footnote="Not copied from the documentation. These are live reads against the deployed bytecode, so anything the README gets wrong shows up here."
    >
      <Row
        label="Prize split"
        sublabel={`${facts.tierSharesBps.length} tiers, one winner each`}
        value={
          <span className="mono">
            {facts.tierSharesBps.map((bps) => `${bps / 100}%`).join(" / ")}
          </span>
        }
      />
      <Row
        label="Draw cadence"
        sublabel="Anyone may seal once this has passed"
        value={<span className="mono">{minutes(facts.drawInterval)}</span>}
      />
      <Row
        label="Total-snapshot interval"
        sublabel="Stops the public total being read around one deposit"
        value={<span className="mono">{minutes(facts.disclosureInterval)}</span>}
      />
      <Row
        label="Positions per slice"
        sublabel="Bounded by the coprocessor's depth limit, not by choice"
        value={<span className="mono">{facts.maxSlice}</span>}
      />
      <Row
        label="Tier threshold"
        sublabel="A ciphertext — set, but not readable by anyone"
        value={
          facts.thresholdSet ? <Sealed label="SET" /> : <span className="row-value">Unset</span>
        }
      />
    </Group>
  );
}

/* ── Draw ───────────────────────────────────────────────────────────── */

/**
 * One step of the draw, offered to whoever is looking.
 *
 * Sealing used to be the operator's alone, which made a draw something a
 * visitor could read about and never cause. Every step is permissionless now,
 * so the panel offers the next one — and a reviewer can take a pool from
 * sealed to settled without asking anyone for a key.
 */
export interface DrawStep {
  readonly label: string;
  readonly busy: boolean;
  /** Why the step cannot be taken right now, if it cannot. */
  readonly blockedBecause?: string;
  readonly run: () => void;
}

/**
 * What the draw controls are, and what they are not.
 *
 * Sealing being open to anyone is a real design decision, not a demo
 * shortcut: it is the "automate draws" half of the brief, and it removes the
 * operator as a thing a draw can wait on. The five minutes is the demo part.
 * A pool holding real savings would draw daily or weekly, and the interval is
 * the only line that would change.
 */
const CADENCE_NOTE =
  "Anyone may start a draw once the cadence allows it — there is no operator to wait for, and every step after sealing was already open. The five-minute interval is a testnet setting so a reviewer can run a full cycle; a real pool would draw daily.";

export function DrawPanel({ draw, step }: { draw: DrawFacts | null; step?: DrawStep }) {
  const blocked = step?.blockedBecause;

  const action =
    step === undefined ? null : (
      <>
        {blocked !== undefined && <Status>{blocked}</Status>}
        <Row>
          <Button
            full
            variant="primary"
            onClick={step.run}
            disabled={step.busy || blocked !== undefined}
          >
            {step.busy ? "Working…" : step.label}
          </Button>
        </Row>
      </>
    );

  if (draw === null) {
    return (
      <Group
        caption="Draw"
        footnote={step === undefined ? undefined : CADENCE_NOTE}
      >
        <div className="empty">No draw has run yet.</div>
        {action}
      </Group>
    );
  }

  const progress = drawProgress(draw);
  const stageState = (stage: DrawState): "pending" | "active" | "done" =>
    draw.state === stage ? "active" : draw.state > stage ? "done" : "pending";

  return (
    <Group
      caption={`Draw ${draw.drawId}`}
      footnote={
        draw.state === DrawState.Selecting
          ? "Selection runs in slices. Each transaction advances the walk over encrypted weights by a bounded number of positions."
          : step === undefined
            ? "Winner selection runs entirely over encrypted balances, weighted by deposit. The random point comes from the protocol's own generator and is never decrypted, so nobody — including the operator — can predict or verify the outcome by inspection."
            : CADENCE_NOTE
      }
    >
      <Row
        label="Stage"
        value={
          <span style={{ display: "inline-flex", gap: 6 }}>
            <Stage state={stageState(DrawState.Sealed)}>Sealed</Stage>
            <Stage state={stageState(DrawState.Selecting)}>Selecting</Stage>
            <Stage state={stageState(DrawState.Settled)}>Settled</Stage>
          </span>
        }
      />

      {draw.state === DrawState.Selecting && (
        <Row>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                color: "var(--ink-secondary)",
              }}
            >
              <span>
                Tier {draw.tierCursor + 1} of {draw.tierCount}
              </span>
              <span className="mono">
                {progress.done} / {progress.total}
              </span>
            </div>
            <Meter value={progress.done} total={progress.total} />
          </div>
        </Row>
      )}

      <Row
        label="Prize"
        value={
          draw.prize === 0n ? (
            <span className="row-value">Fixed when the draw opens</span>
          ) : (
            <span className="amount">{formatAmount(draw.prize)}</span>
          )
        }
      />
      {/*
        Weight shares the token's scale, since it is derived from a balance,
        but it is not an amount anyone is owed — so it is rendered without a
        currency symbol. Showing the raw base-unit integer here would sit a
        number a million times larger next to the deposit total and read as a
        mistake.
      */}
      <Row
        label="Total weight"
        sublabel="Public, so the pool's size is auditable"
        value={<span className="amount">{formatAmount(draw.totalWeight, "")}</span>}
      />
      {/*
        The draw point is generated encrypted by the coprocessors and never
        decrypted — not for the operator, not for this page. Showing it sealed
        is the honest rendering: it exists, it decided the outcome, and nobody
        can read it.
      */}
      <Row
        label="Draw point"
        sublabel={
          draw.state < DrawState.Selecting
            ? "Generated when the draw opens"
            : "Generated encrypted, never revealed"
        }
        value={
          // Before opening there is no point, and the zero handle that stands
          // for "nothing here yet" would otherwise be displayed as though it
          // were one.
          draw.state < DrawState.Selecting ? (
            <span className="row-value">Not yet drawn</span>
          ) : (
            <Sealed handle={draw.drawPointHandle} />
          )
        }
      />
      <Row label="Positions" value={<span className="mono">{draw.participantCount}</span>} />
      {action}
    </Group>
  );
}

/* ── History ────────────────────────────────────────────────────────── */

/**
 * Draws that have already been decided.
 *
 * Nothing here is new information — every figure was public while the draw
 * ran. What the list adds is continuity: a pool showing a single draw reads
 * as one that has run once, and this is the difference between a
 * demonstration and something that has been going for a while.
 *
 * It shows what a draw paid and over how many positions. It does not show
 * who was paid, because it cannot: the awards are ciphertexts, and the only
 * winners named anywhere are the ones who chose to be.
 */
export function HistoryPanel({ draws }: { draws: DrawFacts[] }) {
  if (draws.length === 0) return null;

  return (
    <Group
      caption="Earlier draws"
      footnote="Amounts and position counts were public throughout. Who won each one was not, and still is not, unless that winner decided otherwise."
    >
      {draws.map((draw) => (
        <Row
          key={String(draw.drawId)}
          label={`Draw ${draw.drawId}`}
          sublabel={`${draw.participantCount} position${draw.participantCount === 1 ? "" : "s"} · ${draw.tierCount} tier${draw.tierCount === 1 ? "" : "s"}`}
          value={
            <span className="amount">
              {draw.prize === 0n ? "no prize" : formatAmount(draw.prize)}
            </span>
          }
        />
      ))}
    </Group>
  );
}

/* ── Award ──────────────────────────────────────────────────────────── */

/**
 * A disclosed award, written down so it can be handed to someone.
 *
 * Disclosure is the one place this protocol lets a value out, and until now
 * it ended on-chain with nothing to show for it. A winner who opened their
 * award had no way to point at it except by explaining ACLs to whoever asked.
 *
 * The receipt is deliberately not a claim to be taken on trust: it carries
 * the handle and the registry that vouches for it, so the reader verifies
 * rather than believes. It also says who made it public, because the fact
 * that the holder chose this — and that the pool could not have — is the part
 * worth conveying.
 */
function receiptFor(drawId: bigint, amount: bigint, holder: string): string {
  return [
    `URNA — draw ${drawId}`,
    `Award: ${formatAmount(amount)}`,
    `Holder: ${holder}`,
    "",
    "Made public by the holder. The pool cannot open an award, and the",
    "decision cannot be reversed.",
    "",
    `Registry: ${deployment.explorer}/address/${deployment.disclosure}`,
    `Pool:     ${deployment.explorer}/address/${deployment.pool}`,
  ].join("\n");
}

function Receipt({
  drawId,
  amount,
  holder,
}: {
  drawId: bigint;
  amount: bigint;
  holder: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Row
      label="Receipt"
      sublabel="Amount, holder, and where anyone can check it"
      value={
        <Button
          onClick={() => {
            void navigator.clipboard
              .writeText(receiptFor(drawId, amount, holder))
              .then(() => {
                setCopied(true);
                // Long enough to be read, short enough that the button is
                // never stuck saying something that is no longer happening.
                setTimeout(() => setCopied(false), 2_000);
              })
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      }
    />
  );
}

export function AwardPanel({
  drawId,
  handle,
  holder,
  isPublic,
  hasClaimed,
  revealed,
  busy,
  vantage,
  onReveal,
  onClaim,
  onDisclose,
}: {
  drawId: bigint;
  /** Handle to the encrypted award. */
  handle?: string | null;
  /** The account the award belongs to, for a disclosed award's receipt. */
  holder?: string;
  isPublic: boolean;
  hasClaimed: boolean;
  revealed: bigint | null;
  busy: string | null;
  vantage: Vantage;
  onReveal: () => void;
  onClaim: () => void;
  onDisclose: () => void;
}) {
  const won = revealed !== null && revealed > 0n;
  const observing = vantage === "observer";

  return (
    <Group
      caption={observing ? `This award, seen by anyone · draw ${drawId}` : `Your award · draw ${drawId}`}
      footnote={
        isPublic
          ? "The holder chose to make this award public, so anyone can now verify the amount. That decision was theirs alone, and it cannot be undone."
          : observing
            ? "An onlooker cannot tell a winning award from a losing one. Every participant is credited on every tier; the losers hold an encrypted zero."
            : "Only you can read this. Publishing is your decision — the pool cannot do it for you, and it cannot be reversed."
      }
    >
      <Row
        label="Amount"
        value={
          <ByVantage
            vantage={vantage}
            // A disclosed award is public by definition, so the observer sees
            // the real number. That is the whole point of disclosing it.
            observer={
              isPublic && revealed !== null ? (
                <span className="amount row-value-positive">{formatAmount(revealed)}</span>
              ) : (
                <Redacted width={104} />
              )
            }
            holder={
              revealed === null ? (
                <Sealed handle={handle} />
              ) : (
                <span
                  className={won ? "amount row-value-positive" : "amount row-value-strong"}
                >
                  {formatAmount(revealed)}
                </span>
              )
            }
          />
        }
      />
      <Row
        label="Visibility"
        value={<span style={{ fontSize: 13 }}>{isPublic ? "Public" : "Holder only"}</span>}
      />
      {isPublic && revealed !== null && holder !== undefined && (
        <Receipt drawId={drawId} amount={revealed} holder={holder} />
      )}
      {!observing && (
        <Row>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            {revealed === null && (
              <Button full onClick={onReveal} disabled={busy !== null}>
                {busy === "reveal-award" ? "Decrypting…" : "Reveal"}
              </Button>
            )}
            {!hasClaimed && (
              <Button full variant="primary" onClick={onClaim} disabled={busy !== null}>
                {busy === "claim" ? "Working…" : "Claim"}
              </Button>
            )}
            {!isPublic && won && (
              <Button full onClick={onDisclose} disabled={busy !== null}>
                {busy === "disclose" ? "Working…" : "Make public"}
              </Button>
            )}
          </div>
        </Row>
      )}
    </Group>
  );
}
