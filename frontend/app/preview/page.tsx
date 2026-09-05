"use client";

/**
 * Every panel, in every state, without a chain behind it.
 *
 * Two uses. It is how the interface gets designed and reviewed — an empty pool
 * on a testnet tells you nothing about whether the layout holds when the
 * numbers are long. And it is how a demo gets recorded without depending on a
 * testnet, a faucet, and a relayer all being healthy at the same moment.
 *
 * Nothing here is reachable from the application itself.
 */

import { useState } from "react";

import {
  AwardPanel,
  DrawPanel,
  FaucetPanel,
  MovePanel,
  PoolPanel,
  PositionPanel,
} from "@/components/panels";
import { Group, Status } from "@/components/primitives";
import { DrawState, type DrawFacts } from "@/lib/useProtocol";

const UNIT = 1_000_000n;

/**
 * Figures chosen to be internally consistent, not just plausible-looking.
 *
 * A pool of 4,812,500 at 5% for half a year yields about 120,300, and the
 * total weight sits slightly above the deposit total because positions above
 * the tier threshold carry a bonus. Mock data that does not add up hides
 * exactly the unit and scale errors this page exists to surface.
 */
const DEPOSITS = 4_812_500n * UNIT;
const PRIZE = 120_312n * UNIT;
const TOTAL_WEIGHT = 5_402_140n * UNIT;

const draw = (over: Partial<DrawFacts>): DrawFacts => ({
  drawId: 4n,
  state: DrawState.Settled,
  totalWeight: TOTAL_WEIGHT,
  prize: PRIZE,
  participantCount: 47,
  tierCursor: 2,
  indexCursor: 47,
  tierCount: 3,
  drawPointHandle: `0x${"ab".repeat(32)}`,
  ...over,
});

export default function PreviewPage() {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [award, setAward] = useState<bigint | null>(null);

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <h1 className="masthead-title">Sortis</h1>
          <p className="masthead-subtitle">Interface states</p>
        </div>
      </header>

      <Group caption="About this page">
        <Status>
          Fixed data, no wallet, no chain. Every panel below is shown in the
          states it can actually reach.
        </Status>
      </Group>

      <Divider>Position</Divider>

      <PositionPanel
        connected={false}
        hasPosition={false}
        revealed={null}
        busy={null}
        onReveal={() => {}}
        onHide={() => {}}
      />

      <PositionPanel
        connected
        hasPosition={false}
        revealed={null}
        busy={null}
        onReveal={() => {}}
        onHide={() => {}}
      />

      <PositionPanel
        connected
        hasPosition
        revealed={balance}
        busy={null}
        onReveal={() => setBalance(12_500n * UNIT)}
        onHide={() => setBalance(null)}
      />

      <Divider>Test token</Divider>

      <FaucetPanel busy={null} amount={10_000n * UNIT} onMint={() => {}} />

      <Divider>Move funds</Divider>

      <MovePanel busy={null} hasPosition onDeposit={() => {}} onWithdraw={() => {}} />
      <MovePanel busy="deposit" hasPosition onDeposit={() => {}} onWithdraw={() => {}} />

      <Divider>Pool</Divider>

      <PoolPanel principal={DEPOSITS} prize={PRIZE} participants={47} />

      <Divider>Draw</Divider>

      <DrawPanel draw={null} />
      <DrawPanel
        draw={draw({
          state: DrawState.Sealed,
          prize: 0n,
          tierCursor: 0,
          indexCursor: 0,
        })}
      />
      <DrawPanel draw={draw({ state: DrawState.Selecting, tierCursor: 1, indexCursor: 12 })} />
      <DrawPanel draw={draw({})} />

      <Divider>Award</Divider>

      {/* First tier of a 50/30/20 split on the prize above. */}
      <AwardPanel
        drawId={4n}
        isPublic={false}
        hasClaimed={false}
        revealed={award}
        busy={null}
        onReveal={() => setAward((PRIZE * 50n) / 100n)}
        onClaim={() => {}}
        onDisclose={() => {}}
      />

      <AwardPanel
        drawId={3n}
        isPublic
        hasClaimed
        revealed={(PRIZE * 30n) / 100n}
        busy={null}
        onReveal={() => {}}
        onClaim={() => {}}
        onDisclose={() => {}}
      />

      <AwardPanel
        drawId={2n}
        isPublic={false}
        hasClaimed
        revealed={0n}
        busy={null}
        onReveal={() => {}}
        onClaim={() => {}}
        onDisclose={() => {}}
      />
    </main>
  );
}

function Divider({ children }: { children: string }) {
  return (
    <h2
      style={{
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ink-tertiary)",
        borderTop: "1px solid var(--rule)",
        paddingTop: "var(--space-4)",
        marginTop: "var(--space-6)",
        marginBottom: "var(--space-4)",
      }}
    >
      {children}
    </h2>
  );
}
