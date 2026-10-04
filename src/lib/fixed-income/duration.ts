// ---------------------------------------------------------------------------
// Duration, DV01, and convexity (M7 §10).
//
// Macaulay/Modified Duration use the closed-form weighted-average-time
// formula over the same (exponent, cashFlow) points pricing.ts already
// builds — reusing the one place that knows the fractional-stub-period
// convention, rather than re-deriving cash-flow timing a second time.
//
// DV01 is computed by DIRECT REPRICING (central finite difference) rather
// than the textbook "ModifiedDuration × Price × 0.0001" shortcut — M7 §21
// explicitly asks for DV01 to be checked against "an independently
// calculated repricing approximation", so this makes repricing the primary
// method and the duration-based formula the thing tests cross-check it
// against, not the other way around. It is also more robust: the duration
// shortcut is itself a first-order (linear) approximation of what
// repricing computes directly.
// ---------------------------------------------------------------------------

import { buildPricingPoints, priceFromPoints } from "./pricing";
import { unavailable, type BondTerms, type Result } from "./types";

export interface DurationResult {
  macaulayDurationYears: number;
  modifiedDurationYears: number;
  /** Price change (per 100 face value) for a 1 basis point (0.01 percentage point) parallel rise in yield — always reported as a positive magnitude. */
  dv01: number;
  /** Second-order price sensitivity (years^2), via a 100bp central finite difference. Null when a convexity reading isn't meaningful to report at this tenor (see computeConvexity). */
  convexityYears2: number | null;
}

/** 1 basis point, expressed in the same percentage-point units as couponRatePct/ytmPct (so 0.01 means 0.01 percentage points = 1bp). */
const ONE_BP_PCT = 0.01;
/** 100bp — a wider, more numerically stable bump for the second-derivative (convexity) estimate than 1bp would give. */
const CONVEXITY_BUMP_PCT = 1;

export function computeDuration(terms: BondTerms, settlementDate: Date, ytmPct: number): Result<DurationResult> {
  const built = buildPricingPoints(terms, settlementDate);
  if (!built.ok) return built;
  const { points, freq } = built;

  const price = priceFromPoints(points, freq, ytmPct);
  if (!(price > 0)) return unavailable("INVALID_PRICE", "Duration requires a positive model price at the given yield.");

  const periodRate = ytmPct / 100 / freq;
  let weightedTime = 0;
  for (const p of points) {
    const pv = p.cashFlow / Math.pow(1 + periodRate, p.exponent);
    const timeYears = p.exponent / freq;
    weightedTime += timeYears * pv;
  }
  const macaulayDurationYears = weightedTime / price;
  const modifiedDurationYears = macaulayDurationYears / (1 + periodRate);

  const priceDown = priceFromPoints(points, freq, ytmPct - ONE_BP_PCT);
  const priceUp = priceFromPoints(points, freq, ytmPct + ONE_BP_PCT);
  const dv01 = (priceDown - priceUp) / 2;

  const convexityYears2 = computeConvexityFromPoints(points, freq, ytmPct, price);

  return { ok: true, macaulayDurationYears, modifiedDurationYears, dv01, convexityYears2 };
}

function computeConvexityFromPoints(points: { exponent: number; cashFlow: number }[], freq: number, ytmPct: number, price: number): number | null {
  const priceDown = priceFromPoints(points, freq, ytmPct - CONVEXITY_BUMP_PCT);
  const priceUp = priceFromPoints(points, freq, ytmPct + CONVEXITY_BUMP_PCT);
  const deltaDecimal = CONVEXITY_BUMP_PCT / 100;
  if (price <= 0 || deltaDecimal === 0) return null;
  return (priceUp + priceDown - 2 * price) / (price * deltaDecimal * deltaDecimal);
}

/** Independent cross-check for tests/diagnostics: the textbook linear approximation DV01 ≈ ModifiedDuration × Price × 0.0001. Never used as the primary DV01 — see module header. */
export function approximateDv01FromModifiedDuration(modifiedDurationYears: number, price: number): number {
  return modifiedDurationYears * price * (ONE_BP_PCT / 100);
}
