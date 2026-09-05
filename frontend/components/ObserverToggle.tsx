"use client";

/**
 * The switch between what you see and what everyone else sees.
 *
 * Confidentiality has a presentation problem: it looks exactly like the
 * absence of a feature. A pool that hides balances and a pool that has no
 * balances render identically, so the work that makes the first one possible
 * is invisible in the thing it produces.
 *
 * This makes it visible. The same page, the same data, rendered from two
 * vantage points — the holder's and an onlooker's. Flipping between them is
 * the fastest honest account of what the protocol does and, just as
 * importantly, what it does not hide.
 */

import type { ReactNode } from "react";

export type Vantage = "holder" | "observer";

export function VantageSwitch({
  vantage,
  onChange,
}: {
  vantage: Vantage;
  onChange: (next: Vantage) => void;
}) {
  return (
    <div className="vantage" role="group" aria-label="Point of view">
      <button
        type="button"
        className={`vantage-option${vantage === "holder" ? " vantage-active" : ""}`}
        onClick={() => onChange("holder")}
        aria-pressed={vantage === "holder"}
      >
        You
      </button>
      <button
        type="button"
        className={`vantage-option${vantage === "observer" ? " vantage-active" : ""}`}
        onClick={() => onChange("observer")}
        aria-pressed={vantage === "observer"}
      >
        Anyone else
      </button>
    </div>
  );
}

/**
 * Renders a value as an onlooker would see it: present, sized, unreadable.
 *
 * Deliberately not a lock icon or the word "hidden". A redaction bar is the
 * honest shape — it says a value is there and is being withheld, which is
 * exactly the on-chain situation. The width varies a little per field so the
 * page keeps its rhythm rather than turning into a column of identical marks.
 */
export function Redacted({ width = 92 }: { width?: number }) {
  return <span className="redacted" style={{ width }} aria-label="Not visible to you" />;
}

/**
 * Shows one thing to the holder and another to an onlooker.
 *
 * Taking both branches as props, rather than a value plus a flag, keeps the
 * two renderings side by side in the source. It is much harder to leak
 * something into the observer view by accident when the observer view is
 * written out explicitly next to the one it mirrors.
 */
export function ByVantage({
  vantage,
  holder,
  observer,
}: {
  vantage: Vantage;
  holder: ReactNode;
  observer: ReactNode;
}) {
  return <>{vantage === "holder" ? holder : observer}</>;
}
