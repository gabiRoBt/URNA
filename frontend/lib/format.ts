/**
 * Formatting for values people read rather than compute with.
 */

import { TOKEN_DECIMALS, TOKEN_SYMBOL } from "./config";

/**
 * Renders a token amount with a fixed scale, so columns line up.
 *
 * Pass an empty symbol for quantities measured in token units that are not
 * money — draw weight, for instance, which shares the token's scale because it
 * is derived from a balance, but is not an amount anyone is owed.
 */
export function formatAmount(value: bigint, symbol = TOKEN_SYMBOL): string {
  const unit = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = value / unit;
  const fraction = value % unit;

  const fractionText = fraction
    .toString()
    .padStart(TOKEN_DECIMALS, "0")
    .slice(0, 2);

  const number = `${groupDigits(whole)}.${fractionText}`;
  return symbol === "" ? number : `${number} ${symbol}`;
}

/** Parses a typed amount into token base units. Returns null if unusable. */
export function parseAmount(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;

  const [wholeText = "0", fractionText = ""] = trimmed.split(".");
  if (fractionText.length > TOKEN_DECIMALS) return null;

  const unit = 10n ** BigInt(TOKEN_DECIMALS);
  const whole = BigInt(wholeText === "" ? "0" : wholeText);
  const fraction = BigInt(fractionText.padEnd(TOKEN_DECIMALS, "0") || "0");

  const total = whole * unit + fraction;
  return total > 0n ? total : null;
}

/** Shortens an address to something readable without losing identity. */
export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Renders basis points as a percentage. */
export function formatBps(bps: number | bigint): string {
  const value = Number(bps) / 100;
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}%`;
}

function groupDigits(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
