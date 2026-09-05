"use client";

/**
 * The pool, drawn.
 *
 * The composition carries an argument rather than decorating one: every
 * position is the same size. In any other prize pool you would scale each
 * marker by its deposit, because you could. Here nobody knows the deposits —
 * not other participants, not an onlooker, not the contract drawing the
 * winner — so drawing them differently would be a lie about what the system
 * knows. The uniformity is the proof.
 *
 * The draw animation is the same argument in motion. Positions light in
 * sequence, each for the same beat, because the on-chain walk visits every
 * entry at identical cost and cannot stop when it finds the winner. What you
 * watch is the shape of the real computation, not a flourish standing in for
 * one.
 */

import { useEffect, useMemo, useState } from "react";

export type ScenePhase = "idle" | "sealed" | "drawing" | "settled";

export interface UrnaSceneProps {
  /** How many positions are in the pool. */
  participants: number;
  /** Index of the connected account, if it holds one. */
  youIndex?: number | null;
  phase: ScenePhase;
  /** How far the walk has progressed, as a fraction from 0 to 1. */
  progress?: number;
  /** Index that won, once a draw has settled and the holder knows. */
  winnerIndex?: number | null;
}

const SIZE = 300;
const CENTRE = SIZE / 2;
const ORBIT = 108;

/**
 * Rounds a coordinate to two decimals.
 *
 * Not cosmetic. `Math.sin` and `Math.cos` are permitted to differ in their
 * final bit between implementations, so the same angle can produce
 * 56.46925639128065 on the server and ...64 in the browser. React compares the
 * rendered attributes and reports a hydration mismatch over that last digit.
 *
 * Two decimals is well past what a 300-unit viewBox can express, so nothing is
 * lost and both sides now agree exactly.
 */
const round = (value: number): number => Math.round(value * 100) / 100;

export function UrnaScene({
  participants,
  youIndex = null,
  phase,
  progress = 0,
  winnerIndex = null,
}: UrnaSceneProps) {
  // Cap what is drawn. Past a few dozen the ring stops reading as individuals
  // and becomes texture, and the count is stated in words underneath anyway.
  const shown = Math.min(participants, 36);

  const positions = useMemo(() => {
    return Array.from({ length: shown }, (_, index) => {
      // Start at twelve o'clock and go clockwise, so the first depositor sits
      // where the eye lands first.
      const angle = (index / Math.max(1, shown)) * Math.PI * 2 - Math.PI / 2;
      return {
        index,
        x: round(CENTRE + Math.cos(angle) * ORBIT),
        y: round(CENTRE + Math.sin(angle) * ORBIT),
      };
    });
  }, [shown]);

  // Which marker the walk is currently over. Derived from progress so the
  // animation tracks the real cursor rather than running on its own clock.
  const sweepIndex =
    phase === "drawing" ? Math.floor(progress * shown) % Math.max(1, shown) : -1;

  return (
    <figure className="scene">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="scene-svg"
        role="img"
        aria-label={`${participants} position${participants === 1 ? "" : "s"} around the urn`}
      >
        {/* The orbit the positions sit on. Faint: it is scaffolding. */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={ORBIT}
          className="scene-orbit"
          fill="none"
        />

        <Urn phase={phase} />

        {positions.map((position) => {
          const isYou = position.index === youIndex;
          const isWinner = phase === "settled" && position.index === winnerIndex;
          const isSweeping = position.index === sweepIndex;

          // Positions the walk has already passed. Marking them is what makes
          // the sweep legible as progress rather than as a light wandering
          // around a ring — and it shows the traversal covering everything,
          // which is the property being demonstrated.
          const isVisited = phase === "drawing" && position.index < sweepIndex;

          const classes = ["scene-position"];
          if (isYou) classes.push("scene-you");
          if (isVisited) classes.push("scene-visited");
          if (isWinner) classes.push("scene-winner");
          if (isSweeping) classes.push("scene-sweeping");

          return (
            <g key={position.index}>
              {isWinner && (
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={13}
                  className="scene-winner-halo"
                  fill="none"
                />
              )}
              {isYou && !isWinner && (
                <circle
                  cx={position.x}
                  cy={position.y}
                  r={11}
                  className="scene-you-ring"
                  fill="none"
                />
              )}
              <circle
                cx={position.x}
                cy={position.y}
                r={5.5}
                className={classes.join(" ")}
              />
            </g>
          );
        })}
      </svg>

      <figcaption className="scene-caption">
        {captionFor(phase, participants, youIndex, winnerIndex)}
      </figcaption>
    </figure>
  );
}

/**
 * The urn itself.
 *
 * Drawn in strokes rather than filled: an outline reads as a vessel you cannot
 * see into, which is the whole idea. A solid shape would read as a thing, not
 * as a container with something withheld inside it.
 */
function Urn({ phase }: { phase: ScenePhase }) {
  const active = phase === "drawing";

  return (
    <g className={`scene-urn${active ? " scene-urn-active" : ""}`}>
      {/* Body: a bowl that narrows to a neck. */}
      <path
        d={`
          M ${CENTRE - 26} ${CENTRE - 24}
          L ${CENTRE - 20} ${CENTRE - 30}
          L ${CENTRE + 20} ${CENTRE - 30}
          L ${CENTRE + 26} ${CENTRE - 24}
          C ${CENTRE + 34} ${CENTRE + 4}, ${CENTRE + 22} ${CENTRE + 30}, ${CENTRE} ${CENTRE + 30}
          C ${CENTRE - 22} ${CENTRE + 30}, ${CENTRE - 34} ${CENTRE + 4}, ${CENTRE - 26} ${CENTRE - 24}
          Z
        `}
        fill="none"
      />
      {/* The mouth. A line, not an opening you can see through. */}
      <line
        x1={CENTRE - 20}
        y1={CENTRE - 30}
        x2={CENTRE + 20}
        y2={CENTRE - 30}
      />
      {/* Foot. */}
      <line x1={CENTRE - 12} y1={CENTRE + 30} x2={CENTRE + 12} y2={CENTRE + 30} />
    </g>
  );
}

function captionFor(
  phase: ScenePhase,
  participants: number,
  youIndex: number | null,
  winnerIndex: number | null,
): string {
  const count = `${participants} position${participants === 1 ? "" : "s"}`;

  switch (phase) {
    case "idle":
      return participants === 0
        ? "No positions yet."
        : `${count}, all drawn the same size — nobody knows the amounts.`;
    case "sealed":
      return `${count} sealed into this draw.`;
    case "drawing":
      return "Every position is visited, at identical cost. The walk cannot stop early.";
    case "settled":
      return winnerIndex !== null && winnerIndex === youIndex
        ? "You won this draw."
        : `${count}. Only the winner can read what they won.`;
  }
}

/**
 * Derives the scene's phase and progress from the draw state.
 *
 * Kept beside the scene rather than in the page, so a change to how a draw is
 * represented does not have to be made in two places.
 */
export function useScenePhase(
  drawState: number | null,
  tierCursor: number,
  indexCursor: number,
  participantCount: number,
  tierCount: number,
): { phase: ScenePhase; progress: number } {
  const [phase, setPhase] = useState<ScenePhase>("idle");

  const total = Math.max(1, participantCount * Math.max(1, tierCount));
  const done = tierCursor * participantCount + indexCursor;
  const progress = Math.min(1, done / total);

  useEffect(() => {
    if (drawState === null) return setPhase("idle");
    if (drawState === 1) return setPhase("sealed");
    if (drawState === 2) return setPhase("drawing");
    if (drawState === 3) return setPhase("settled");
    return setPhase("idle");
  }, [drawState]);

  return { phase, progress };
}

/** How long the walk takes to cross the whole ring, in milliseconds. */
const WALK_DURATION = 3200;
const SEAL_PAUSE = 900;

/**
 * Plays a draw, rather than letting someone step through its states.
 *
 * The earlier version exposed one button per phase, which is a developer's
 * control panel: a visitor has no idea what to press or why the labels mean
 * anything. Running the sequence in time removes the question — you press
 * once and watch what a draw does.
 *
 * The pace is chosen so the sweep is followable. It could run much faster,
 * but the thing worth noticing is that every position gets an identical
 * moment, and at speed that reads as a blur rather than as a rule.
 */
export function useDrawPlayback(): {
  phase: ScenePhase;
  progress: number;
  playing: boolean;
  play: () => void;
} {
  const [phase, setPhase] = useState<ScenePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    if (runId === 0) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      // Honour the preference by showing the outcome rather than the journey.
      setPhase("settled");
      setProgress(1);
      return;
    }

    setPhase("sealed");
    setProgress(0);

    // Progress is computed from the clock on every tick rather than
    // accumulated frame by frame. Two reasons, and the second is a real bug
    // the frame-based version had: browsers stop firing animation frames in a
    // hidden tab, so switching away mid-draw left the sweep frozen and the
    // draw never reached its settled state. Reading the clock means a tab that
    // comes back simply resumes at the right place — or finds the draw already
    // finished, which is also correct.
    const started = Date.now();
    const total = SEAL_PAUSE + WALK_DURATION;

    const tick = (): void => {
      const elapsed = Date.now() - started;

      if (elapsed < SEAL_PAUSE) return;

      if (elapsed >= total) {
        setPhase("settled");
        setProgress(1);
        clearInterval(timer);
        return;
      }

      setPhase("drawing");
      setProgress((elapsed - SEAL_PAUSE) / WALK_DURATION);
    };

    const timer = setInterval(tick, 40);

    return () => clearInterval(timer);
  }, [runId]);

  return {
    phase,
    progress,
    playing: phase === "sealed" || phase === "drawing",
    play: () => setRunId((current) => current + 1),
  };
}
