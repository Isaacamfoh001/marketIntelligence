// ---------------------------------------------------------------------------
// Current Yield and Yield to Maturity (M7 §9).
//
// YTM is solved by bisection, not Newton-Raphson: bond price is strictly
// monotonically decreasing in yield for any bond with positive cash flows
// (true for every conventional coupon bond), so bisection over a wide
// bracket always converges without the divergence risk Newton's method can
// hit from a bad starting guess — "a robust numerical solution" (M7 §9)
// that needs no derivative and is trivial to reason about and test.
// ---------------------------------------------------------------------------

import { buildPricingPoints, priceFromPoints } from "./pricing";
import { unavailable, type BondTerms, type Result } from "./types";

/** Coupon income (full annual coupon, independent of payment frequency) relative to the clean market price — M7 §9's "Current Yield". */
export function computeCurrentYield(terms: BondTerms, cleanPrice: number): Result<{ currentYieldPct: number }> {
  if (!(cleanPrice > 0)) return unavailable("INVALID_PRICE", "Current yield requires a positive market price.");
  if (terms.couponType === "ZERO_COUPON") return unavailable("FLOATING_RATE_UNSUPPORTED", "A zero-coupon instrument has no periodic coupon — current yield is not meaningful.");
  if (terms.couponType === "FLOATING") return unavailable("FLOATING_RATE_UNSUPPORTED", "Current yield is not computed for floating-rate instruments.");
  if (terms.couponRatePct === null) return unavailable("MISSING_MARKET_DATA", "This instrument is missing its coupon rate.");

  const annualCoupon = terms.faceValue * (terms.couponRatePct / 100);
  return { ok: true, currentYieldPct: (annualCoupon / cleanPrice) * 100 };
}

const YTM_LOWER_BOUND_PCT = -99;
const YTM_UPPER_BOUND_PCT = 1000;
const MAX_ITERATIONS = 200;
const PRICE_TOLERANCE = 1e-7;

/**
 * Solves for the flat annual yield that reprices the bond to `dirtyPrice`
 * (the full/invoice price — add accrued interest to a quoted clean price
 * before calling this, via accrued.ts's cleanToDirty).
 */
export function computeYtm(terms: BondTerms, settlementDate: Date, dirtyPrice: number): Result<{ ytmPct: number }> {
  if (!(dirtyPrice > 0)) return unavailable("INVALID_PRICE", "Yield to maturity requires a positive market price.");

  const built = buildPricingPoints(terms, settlementDate);
  if (!built.ok) return built;
  const { points, freq } = built;

  const priceAt = (yPct: number) => priceFromPoints(points, freq, yPct);

  let lo = YTM_LOWER_BOUND_PCT;
  let hi = YTM_UPPER_BOUND_PCT;
  const priceLo = priceAt(lo);
  const priceHi = priceAt(hi);
  // Price is monotonically decreasing in yield, so priceLo must exceed the
  // target and priceHi must fall short — otherwise no root exists in this
  // (generously wide) bracket and the input is not a sane market price.
  if (!(priceLo >= dirtyPrice && priceHi <= dirtyPrice)) {
    return unavailable("NON_CONVERGENT", "Could not solve for a yield to maturity within a -99% to 1000% bracket for this price.");
  }

  let mid = (lo + hi) / 2;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    mid = (lo + hi) / 2;
    const priceMid = priceAt(mid);
    if (Math.abs(priceMid - dirtyPrice) < PRICE_TOLERANCE) break;
    if (priceMid > dirtyPrice) {
      lo = mid; // price too high -> yield too low
    } else {
      hi = mid;
    }
  }

  return { ok: true, ytmPct: mid };
}
