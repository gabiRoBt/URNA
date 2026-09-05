"use client";

/**
 * What Urna is, in one page, with no wallet and no chain.
 *
 * This was a catalogue of component states, which was useful for building the
 * interface and useless for understanding it. Someone opening it learned what
 * the panels look like, not what the thing does.
 *
 * It now walks the argument instead: what a prize pool is, what a public chain
 * gives away, what this hides, and what it deliberately does not. The panels
 * appear along the way as illustrations rather than as a list.
 */

import { useState } from "react";

import { AwardPanel, PoolPanel, PositionPanel } from "@/components/panels";
import { Group, Row } from "@/components/primitives";
import { Redacted, VantageSwitch, type Vantage } from "@/components/ObserverToggle";
import { UrnaScene, useDrawPlayback } from "@/components/UrnaScene";
import { Wordmark } from "@/components/Wordmark";

const UNIT = 1_000_000n;

/**
 * Figures chosen to be internally consistent, not merely plausible. A pool of
 * 4,812,500 at 5% for half a year yields about 120,300; total weight sits
 * above the deposit total because positions over the tier threshold carry a
 * bonus. Numbers that do not add up hide exactly the unit and scale errors a
 * page like this exists to surface.
 */
const DEPOSITS = 4_812_500n * UNIT;
const PRIZE = 120_312n * UNIT;
const YOUR_BALANCE = 12_500n * UNIT;
const YOUR_AWARD = (PRIZE * 50n) / 100n;

export default function PreviewPage() {
  const { phase, progress, playing, play } = useDrawPlayback();
  const [vantage, setVantage] = useState<Vantage>("holder");
  const [revealed, setRevealed] = useState<bigint | null>(null);

  return (
    <main className={`shell${vantage === "observer" ? " observing" : ""}`}>
      <header className="masthead">
        <div>
          <h1 className="masthead-title">
            <Wordmark />
          </h1>
          <p className="masthead-subtitle">How it works</p>
        </div>
      </header>

      <Section
        number={1}
        title="A prize pool, first"
        body="Everyone puts money into a shared pot. The pot earns interest. Nobody loses anything — you can take your deposit back whenever you like. What is at stake is only the interest, and at each draw it goes to one depositor, chosen at random. Deposit more, and your chance is proportionally larger."
      />

      <UrnaScene participants={24} youIndex={3} phase="idle" />

      <Section
        number={2}
        title="On a public chain, this leaks everything"
        body="Ordinarily every deposit is visible. Anyone can read how much you have saved, work out your odds, and see what you won. Large depositors become targets, and everyone's finances are on display to anyone who cares to look."
      />

      <Group caption="What a normal pool would show">
        <Row label="0x8f3a…c21d" value={<span className="amount">142,000.00 cUSD</span>} />
        <Row label="0x4b91…7ea0" value={<span className="amount">8,200.00 cUSD</span>} />
        <Row
          label="0x2c77…19bb"
          sublabel="Odds: 29.5%"
          value={<span className="amount">1,420,000.00 cUSD</span>}
        />
      </Group>

      <Section
        number={3}
        title="Here, the amounts are encrypted"
        body="Deposits are encrypted in your browser before they are sent, and stay encrypted on-chain. Notice that every position in the picture is the same size — in any other pool you would draw them scaled by deposit, because you could. Nobody here knows the amounts, so drawing them differently would be a lie about what the system knows."
      />

      <Group caption="Your position">
        <Row
          label="Balance"
          value={
            revealed === null ? (
              <span className="sealed">SEALED</span>
            ) : (
              <span className="amount row-value-strong">
                {(Number(YOUR_BALANCE) / 1e6).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                })}{" "}
                cUSD
              </span>
            )
          }
        />
        <Row>
          <button
            type="button"
            className="button button-full"
            onClick={() => setRevealed(revealed === null ? YOUR_BALANCE : null)}
          >
            {revealed === null ? "Reveal balance" : "Hide"}
          </button>
        </Row>
      </Group>

      <p className="note">
        Revealing decrypts locally, in this browser, after you sign. It publishes
        nothing.
      </p>

      <Section
        number={4}
        title="See it from the other side"
        body="Confidentiality has a presentation problem: it looks exactly like the absence of a feature. So here is the same position rendered as anyone else sees it. The switch changes nothing on-chain — only what the screen is allowed to draw."
      />

      <Group caption="Point of view">
        <Row
          label={vantage === "observer" ? "Viewing as an onlooker" : "Viewing as yourself"}
          value={<VantageSwitch vantage={vantage} onChange={setVantage} />}
        />
      </Group>

      <PositionPanel
        connected
        hasPosition
        revealed={YOUR_BALANCE}
        busy={null}
        vantage={vantage}
        onReveal={() => {}}
        onHide={() => {}}
      />

      <Section
        number={5}
        title="What stays public, honestly"
        body="Not everything is hidden, and pretending otherwise would be dishonest. The pool's total is public because the venue holding the money knows how much it holds. An aggregate says nothing about its parts: knowing a pool holds 4.8 million tells you nothing about who holds what."
      />

      <PoolPanel principal={DEPOSITS} prize={PRIZE} participants={47} />

      <Section
        number={6}
        title="The draw runs on the encrypted amounts"
        body="A random point is generated on-chain and never decrypted — not for the operator, not for us. The contract then walks every position, adding up encrypted weights until it passes that point. It cannot stop when it finds the winner, because it is never allowed to learn that it has. Watch the sweep: every position gets exactly the same moment, which is why the walk itself gives nothing away."
      />

      <UrnaScene
        participants={24}
        youIndex={3}
        phase={phase}
        progress={progress}
        winnerIndex={3}
      />

      <div className="scene-controls">
        <button
          type="button"
          className="button button-primary"
          onClick={play}
          disabled={playing}
        >
          {playing ? "Drawing…" : phase === "settled" ? "Draw again" : "Run a draw"}
        </button>
      </div>

      <Section
        number={7}
        title="Only the winner learns what they won"
        body="Every participant is credited on every tier — the winner receives the prize, everyone else an encrypted zero, and nothing distinguishes them from outside. A winner who wants to prove a payout can open their own award. The pool can never open it for them, and the decision cannot be reversed."
      />

      <AwardPanel
        drawId={4n}
        isPublic={false}
        hasClaimed={false}
        revealed={YOUR_AWARD}
        busy={null}
        vantage="holder"
        onReveal={() => {}}
        onClaim={() => {}}
        onDisclose={() => {}}
      />

      <AwardPanel
        drawId={4n}
        isPublic={false}
        hasClaimed
        revealed={YOUR_AWARD}
        busy={null}
        vantage="observer"
        onReveal={() => {}}
        onClaim={() => {}}
        onDisclose={() => {}}
      />

      <Section
        number={8}
        title="And your money was never at risk"
        body="Principal is withdrawable at any time, including while a draw is running. A position sealed into a draw keeps the odds it had when the draw closed, so leaving early costs you nothing you had already earned."
      />

      <footer className="preview-footer">
        Fixed data, no wallet, no chain. Every figure here is illustrative.
      </footer>
    </main>
  );
}

function Section({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <section className="explain">
      {/* Numbered because this is genuinely a sequence: each step only makes
          sense once the one before it has landed. */}
      <div className="explain-number">{number}</div>
      <div>
        <h2 className="explain-title">{title}</h2>
        <p className="explain-body">{body}</p>
      </div>
    </section>
  );
}
