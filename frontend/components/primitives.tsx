/**
 * The interface's structural vocabulary.
 *
 * Five components. A group, a row, a sealed value, a button, a status line.
 * Everything on the page is built from these, which is what keeps spacing and
 * alignment consistent without a single one-off style.
 */

import type { ReactNode } from "react";

export function Group({
  caption,
  footnote,
  children,
}: {
  caption?: string;
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="group">
      {caption !== undefined && <h2 className="group-caption">{caption}</h2>}
      <div className="group-body">{children}</div>
      {footnote !== undefined && <p className="group-footnote">{footnote}</p>}
    </section>
  );
}

export function Row({
  label,
  sublabel,
  value,
  children,
}: {
  label?: ReactNode;
  sublabel?: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
}) {
  if (children !== undefined) {
    return <div className="row row-stacked">{children}</div>;
  }

  return (
    <div className="row">
      <div className="row-label">
        {label}
        {sublabel !== undefined && <span className="row-sublabel">{sublabel}</span>}
      </div>
      <div className="row-value">{value}</div>
    </div>
  );
}

/**
 * A value that exists on-chain but is withheld.
 *
 * Shown as a sealed field rather than a blank, a dash, or a spinner. Those all
 * read as "missing" or "still loading"; this reads as "present, and not yours
 * to see" — which is the actual state, and the whole point of the protocol.
 */
export function Sealed({ label = "SEALED" }: { label?: string }) {
  return (
    <span className="sealed" title="Encrypted on-chain. Only the holder can read it.">
      <svg className="sealed-mark" viewBox="0 0 9 11" aria-hidden="true">
        <path d="M2 4.5V3a2.5 2.5 0 0 1 5 0v1.5" />
        <rect x="0.7" y="4.5" width="7.6" height="5.8" rx="1" />
      </svg>
      {label}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled = false,
  full = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "quiet";
  disabled?: boolean;
  full?: boolean;
  type?: "button" | "submit";
}) {
  const classes = ["button"];
  if (variant === "primary") classes.push("button-primary");
  if (variant === "quiet") classes.push("button-quiet");
  if (full) classes.push("button-full");

  return (
    <button
      type={type}
      className={classes.join(" ")}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Status({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "error" | "working";
}) {
  const classes = ["status"];
  if (tone === "error") classes.push("status-error");
  if (tone === "working") classes.push("status-working");
  return <div className={classes.join(" ")}>{children}</div>;
}

export function Stage({
  children,
  state = "pending",
}: {
  children: ReactNode;
  state?: "pending" | "active" | "done";
}) {
  const classes = ["stage"];
  if (state === "active") classes.push("stage-active");
  if (state === "done") classes.push("stage-done");
  return <span className={classes.join(" ")}>{children}</span>;
}

export function Meter({ value, total }: { value: number; total: number }) {
  const percent = total === 0 ? 0 : Math.min(100, (value / total) * 100);
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className="meter-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
