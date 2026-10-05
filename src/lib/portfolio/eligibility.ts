// ---------------------------------------------------------------------------
// Which instruments may be ADDED to a portfolio (M8.1 §18). Only states that
// can never be responsibly supported are blocked: a matured bond, a
// floating-rate bond, a non-GHS instrument, an inactive equity. An outstanding
// instrument that merely lacks a usable market input is ALLOWED — it is
// recorded and listed as "not valued" with the reason, never given a zero.
// ---------------------------------------------------------------------------

import type { SecurityLifecycle } from "../fixed-income";

export type Addable = { addable: true } | { addable: false; reason: string };

export function checkBondAddable(bond: { currency: string; lifecycle: SecurityLifecycle; couponType: "FIXED" | "FLOATING" | "ZERO_COUPON" }): Addable {
  if (bond.currency !== "GHS") return { addable: false, reason: `Only GHS instruments are supported in portfolios (this one is ${bond.currency}).` };
  if (bond.lifecycle === "MATURED") return { addable: false, reason: "This bond has matured and can no longer be held." };
  if (bond.couponType === "FLOATING") return { addable: false, reason: "Floating-rate bonds are not supported — their future coupons cannot be projected." };
  return { addable: true };
}

export function checkEquityAddable(equity: { currency: string; active: boolean }): Addable {
  if (equity.currency !== "GHS") return { addable: false, reason: `Only GHS instruments are supported in portfolios (this one is ${equity.currency}).` };
  if (!equity.active) return { addable: false, reason: "This security is inactive (delisted or suspended)." };
  return { addable: true };
}
