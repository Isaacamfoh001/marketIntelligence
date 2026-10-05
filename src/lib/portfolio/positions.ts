// ---------------------------------------------------------------------------
// Position rules (M8.1 §10/§11): what may be recorded and how duplicates are
// handled. Pure validation shared by the server action and the tests; the
// database CHECK constraint ("PortfolioPosition_shape_check") is the backstop,
// not the first line of defence.
// ---------------------------------------------------------------------------

import type { InstrumentRef, PortfolioAssetClass, PositionHolding } from "./types";

/** Sanity bounds — generous, not tuned to any current holding. */
export const MAX_NOMINAL_GHS = 1e15;
/** `shares` is a 32-bit integer column. */
export const MAX_SHARES = 2_147_483_647;

export interface PositionDraft {
  assetClass: PortfolioAssetClass;
  /** Bonds only. */
  nominalGhs?: number | null;
  /** Equities only. */
  shares?: number | null;
  /** The instrument's own currency — only GHS is supported in M8 V1. */
  currency: string;
}

export type PositionSize = { ok: true; assetClass: "BOND"; nominalGhs: number } | { ok: true; assetClass: "EQUITY"; shares: number } | { ok: false; error: string };

/**
 * Validates a position's size for its asset class. Rejects: non-GHS
 * instruments, zero/negative/non-finite sizes (no shorts), fractional equity
 * shares, a bond given shares or an equity given a nominal (no ambiguous
 * quantity field), and sub-cent nominals.
 */
export function validatePositionDraft(draft: PositionDraft): PositionSize {
  if (draft.currency !== "GHS") {
    return { ok: false, error: `Only GHS instruments are supported (this one is ${draft.currency}).` };
  }
  if (draft.assetClass === "BOND") {
    if (draft.shares !== null && draft.shares !== undefined) return { ok: false, error: "A bond position is recorded as a nominal GHS amount, not shares." };
    const n = draft.nominalGhs;
    if (n === null || n === undefined || !Number.isFinite(n)) return { ok: false, error: "Enter the nominal amount in GHS." };
    if (n <= 0) return { ok: false, error: "Nominal must be greater than zero — short and zero positions are not supported." };
    if (n > MAX_NOMINAL_GHS) return { ok: false, error: "Nominal is implausibly large." };
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: "Nominal can have at most two decimal places." };
    return { ok: true, assetClass: "BOND", nominalGhs: Math.round(n * 100) / 100 };
  }
  if (draft.nominalGhs !== null && draft.nominalGhs !== undefined) return { ok: false, error: "An equity position is recorded as a number of shares, not a nominal amount." };
  const s = draft.shares;
  if (s === null || s === undefined || !Number.isFinite(s)) return { ok: false, error: "Enter the number of shares." };
  if (!Number.isInteger(s)) return { ok: false, error: "Shares must be a whole number — fractional shares are not supported." };
  if (s <= 0) return { ok: false, error: "Shares must be greater than zero — short and zero positions are not supported." };
  if (s > MAX_SHARES) return { ok: false, error: `Shares cannot exceed ${MAX_SHARES.toLocaleString("en-GB")}.` };
  return { ok: true, assetClass: "EQUITY", shares: s };
}

/** The existing position in `positions` for the same instrument, if any — one position per instrument per portfolio (M8.1 §10). */
export function findExistingPosition(positions: PositionHolding[], candidate: InstrumentRef): PositionHolding | null {
  return (
    positions.find((p) => {
      if (p.assetClass !== candidate.assetClass) return false;
      return p.assetClass === "BOND" ? p.fixedIncomeSecurityId === (candidate as { fixedIncomeSecurityId: string }).fixedIncomeSecurityId : p.securityId === (candidate as { securityId: string }).securityId;
    }) ?? null
  );
}

/** Parses a user-entered number ("2,000,000", " 100000 ") strictly; null when it is not wholly a number. */
export function parseEnteredNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (cleaned === "" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
