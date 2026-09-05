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

import { Button, Group, Meter, Row, Sealed, Stage } from "./primitives";
import { ByVantage, Redacted, type Vantage } from "./ObserverToggle";
import { TOKEN_SYMBOL } from "@/lib/config";
import { formatAmount, parseAmount } from "@/lib/format";
import { DrawState, drawProgress, type DrawFacts } from "@/lib/useProtocol";

/* ── Position ───────────────────────────────────────────────────────── */

export function PositionPanel({
  connected,
  hasPosition,
  revealed,
  busy,
  vantage,
  onReveal,
  onHide,
}: {
  connected: boolean;
  hasPosition: boolean;
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
                <Sealed />
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
  onDeposit,
  onWithdraw,
}: {
  busy: string | null;
  hasPosition: boolean;
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
      <Row>
        <div className="field">
          <input
            className="input"
            inputMode="decimal"
            placeholder={`Amount in ${TOKEN_SYMBOL}`}
            value={depositText}
            onChange={(event) => setDepositText(event.target.value)}
            aria-label="Deposit amount"
          />
          <Button
            variant="primary"
            disabled={depositAmount === null || busy !== null}
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

export function PoolPanel({
  principal,
  prize,
  participants,
}: {
  principal: bigint;
  prize: bigint;
  participants: number;
}) {
  return (
    <Group
      caption="Pool"
      footnote="Aggregates are public because the yield venue holds real assets and knows how much it holds. A total says nothing about who holds what."
    >
      <Row
        label="Total deposits"
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

/* ── Draw ───────────────────────────────────────────────────────────── */

export function DrawPanel({ draw }: { draw: DrawFacts | null }) {
  if (draw === null) {
    return (
      <Group caption="Draw">
        <div className="empty">No draw has run yet.</div>
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
          : "Winner selection runs entirely over encrypted balances, weighted by deposit. The random point comes from the protocol's own generator and is never decrypted, so nobody — including the operator — can predict or verify the outcome by inspection."
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
        sublabel="Generated encrypted, never revealed"
        value={<Sealed />}
      />
      <Row label="Positions" value={<span className="mono">{draw.participantCount}</span>} />
    </Group>
  );
}

/* ── Award ──────────────────────────────────────────────────────────── */

export function AwardPanel({
  drawId,
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
                <Sealed />
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
