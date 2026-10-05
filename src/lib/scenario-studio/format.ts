// ---------------------------------------------------------------------------
// Display formatting for Scenario Studio (M8.4). Pure. Rounds ONLY for display —
// every figure shown comes from the M8.3 result unchanged; exact (pesewa)
// values are always available in the technical disclosure.
// ---------------------------------------------------------------------------

const MINUS = "−";

const group = (n: number, dp: number) => Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const signOf = (n: number): "" | "+" | typeof MINUS => (n > 0 ? "+" : n < 0 ? MINUS : "");

/** "GHS 6.87m" / "GHS 394.9k" / "GHS 850" — a readable magnitude for headline copy. Unsigned. */
export function ghsCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `GHS ${(a / 1_000_000).toFixed(2)}m`;
  if (a >= 1_000) return `GHS ${(a / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `GHS ${group(a, 0)}`;
}

/** "GHS 394,866" — whole cedis, unsigned. */
export const ghsWhole = (n: number): string => `GHS ${group(n, 0)}`;

/** "GHS 1,594,225.53" — exact to the pesewa, unsigned. */
export const ghsExact = (n: number): string => `GHS ${group(n, 2)}`;

/** "−GHS 394,866" / "+GHS 1,200" — whole cedis with an explicit sign (never colour alone). */
export const signedGhsWhole = (n: number): string => `${signOf(Math.round(n) === 0 ? 0 : n)}${ghsWhole(n)}`;

export const signedGhsExact = (n: number): string => `${signOf(n)}${ghsExact(n)}`;

export const signedGhsCompact = (n: number): string => `${signOf(Math.round(n) === 0 ? 0 : n)}${ghsCompact(n)}`;

/** "−5.75%" with two decimals; "—" when there is no percentage. */
export const signedPct = (n: number | null, dp = 2): string => (n === null ? "—" : `${signOf(Number(n.toFixed(dp)) === 0 ? 0 : n)}${group(n, dp)}%`);

export const pct = (n: number, dp = 1): string => `${group(n, dp)}%`;

export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** "One" / "Three" / "12" — small counts as words at the start of a sentence. */
export const countWord = (n: number): string => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));

export const MINUS_SIGN = MINUS;
