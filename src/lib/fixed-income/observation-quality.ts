// ---------------------------------------------------------------------------
// Observation data quality (M7.3.1).
//
// Separates "we have this observation" from "this observation is safe to
// use in derived analytics" (yield curve, sovereign benchmark, spreads,
// Current Opportunities, alternatives). Every rule is a deterministic
// INTEGRITY check with evidence behind it — never "the yield looks too
// high". Ghanaian yields genuinely reach 50–60% (e.g. GoG Jan-27 traded at
// 55.71% on 8 Jul 2026, and Korbly independently solves 56.12% from the
// traded price); such prints stay VALID.
//
//   VALID     — usable in derived analytics.
//   REVIEW    — integrity is uncertain (the source contradicts itself or the
//               Securities Master); visible with its evidence, withheld from
//               derived analytics until an analyst resolves it.
//   EXCLUDED  — deterministically not a usable dated market price (no trade
//               on the date, on/after maturity, or nothing computable);
//               kept for provenance, never used in analytics.
//
// Pure, no I/O — the same function runs for every surface and in tests.
// ---------------------------------------------------------------------------

import { computeYtm } from "./yield";
import { computeAccruedInterest } from "./accrued";
import { daysBetween } from "./cashflow";
import type { BondTerms } from "./types";

export type ObservationQualityStatus = "VALID" | "REVIEW" | "EXCLUDED";

export type ObservationIssueCode =
  | "NOT_TRADED"
  | "POST_MATURITY"
  | "MATURITY_CONFLICT"
  | "COUPON_CONFLICT"
  | "YIELD_MISMATCH"
  | "DUPLICATED_VOLUME"
  | "CALCULATION_FAILED"
  | "MATURITY_DATE_ADJUSTMENT";

export interface ObservationIssue {
  code: ObservationIssueCode;
  /** INFO issues never change the status — they explain a benign difference (e.g. a weekend business-day adjustment). */
  severity: "INFO" | "REVIEW" | "EXCLUDED";
  /** Short label for badges. */
  label: string;
  /** One-sentence factual explanation with the numbers involved. */
  detail: string;
}

export interface ObservationQuality {
  status: ObservationQualityStatus;
  analyticsEligible: boolean;
  issues: ObservationIssue[];
}

/**
 * Source-quoted yield vs Korbly's price-solved YTM disagreement above which
 * an observation needs review. Evidence (M7.3.1): re-solving all 90 genuine
 * GoG trades in GFIM's reports (Mar–Oct 2026) at their own trade dates,
 * Korbly matched GFIM within 25 bps on 81 (median 1 bp, 90th percentile
 * 27 bps — settlement-lag/day-count/rounding noise). Only 5 trades exceeded
 * 100 bps, up to 2,125 bps. 100 bps is >3× the normal noise band and sits
 * in the clear gap between convention noise and genuine contradictions.
 */
export const YIELD_MISMATCH_THRESHOLD_BPS = 100;

/**
 * Source and Securities Master maturity dates differing by at most this
 * many days are treated as a payment-date business-day adjustment, not a
 * terms conflict (e.g. GoG GHGGOG050246: master 28 May 2028 — a Sunday —
 * vs GFIM 29 May 2028). Over a week is a material terms disagreement.
 */
export const MATURITY_ADJUSTMENT_TOLERANCE_DAYS = 7;

export interface QualityInput {
  terms: BondTerms;
  observationDate: Date;
  /** Null for sources that don't report trade activity (manual imports, primary auctions) — treated as a reported price, not a carried one. */
  tradeStatus: "TRADED" | "NOT_TRADED" | null;
  cleanPrice: number | null;
  sourceYieldPct: number | null;
  /** The source row's own maturity date / description, when the source provided them (GFIM). */
  sourceMaturityDate: Date | null;
  sourceSecurityDescription: string | null;
  /** Other instruments in the SAME report row-block whose traded volume and trade count are identical to the cent (see findDuplicatedVolumes). Omit/empty when none. */
  duplicatedVolumeWith?: string[];
}

const DESCRIPTION_RE = /^[A-Z]{3}-[A-Z]{2}-(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})-[A-Z0-9]+(?:-\d+)?(?:-(\d+(?:\.\d+)?))?$/i;

/**
 * GFIM's security description encodes maturity and (usually) coupon, e.g.
 * "KCP-NT-12/09/28-C0933-23.50" or "GOG-BD-02/11/26-A4338-1511-19.00".
 * Returns what it states, or nulls when the description doesn't follow
 * that convention — an unparseable description is never a conflict.
 */
export function parseSourceDescription(description: string | null): { maturityDate: Date | null; couponPct: number | null } {
  const m = description ? DESCRIPTION_RE.exec(description.trim()) : null;
  if (!m) return { maturityDate: null, couponPct: null };
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const validDate = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  const coupon = m[4] !== undefined ? Number(m[4]) : null;
  return { maturityDate: validDate ? date : null, couponPct: coupon !== null && coupon > 0 && coupon < 100 ? coupon : null };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YTM implied by the observation's price at its OWN date (the yield the market traded at), or the reason it cannot be solved. */
export function solveObservedYtm(terms: BondTerms, observationDate: Date, cleanPrice: number): { ok: true; ytmPct: number; accruedInterest: number } | { ok: false; message: string } {
  const accrued = computeAccruedInterest(terms, observationDate);
  if (!accrued.ok) return { ok: false, message: accrued.message };
  const ytm = computeYtm(terms, observationDate, cleanPrice + accrued.accruedInterest);
  if (!ytm.ok) return { ok: false, message: ytm.message };
  return { ok: true, ytmPct: ytm.ytmPct, accruedInterest: accrued.accruedInterest };
}

export function assessObservationQuality(input: QualityInput): ObservationQuality {
  const issues: ObservationIssue[] = [];
  const { terms, observationDate } = input;

  if (input.tradeStatus === "NOT_TRADED") {
    issues.push({
      code: "NOT_TRADED",
      severity: "EXCLUDED",
      label: "No trade",
      detail: `The source reports no trade on ${iso(observationDate)}; its closing price is carried forward from an earlier trade and is not a market price for this date.`,
    });
  }

  if (observationDate.getTime() >= terms.maturityDate.getTime()) {
    issues.push({
      code: "POST_MATURITY",
      severity: "EXCLUDED",
      label: "After maturity",
      detail: `Dated ${iso(observationDate)}, on or after the contractual maturity of ${iso(terms.maturityDate)} in the Securities Master.`,
    });
  }

  // --- Terms agreement between the source row and the Securities Master ----
  const described = parseSourceDescription(input.sourceSecurityDescription);
  const sourceMaturities = [input.sourceMaturityDate, described.maturityDate].filter((d): d is Date => d !== null);
  const worstGap = sourceMaturities.reduce((max, d) => Math.max(max, Math.abs(daysBetween(terms.maturityDate, d))), 0);
  if (worstGap > MATURITY_ADJUSTMENT_TOLERANCE_DAYS) {
    const stated = [...new Set(sourceMaturities.map(iso))].join(" / ");
    issues.push({
      code: "MATURITY_CONFLICT",
      severity: "REVIEW",
      label: "Maturity conflict",
      detail: `The source states maturity ${stated}, but the Securities Master holds ${iso(terms.maturityDate)} — the two GFIM publications disagree, so cash flows and yield are uncertain.`,
    });
  } else if (worstGap > 0) {
    issues.push({
      code: "MATURITY_DATE_ADJUSTMENT",
      severity: "INFO",
      label: "Maturity date adjusted",
      detail: `The source states maturity ${[...new Set(sourceMaturities.map(iso))].join(" / ")} vs ${iso(terms.maturityDate)} in the Securities Master — within ${MATURITY_ADJUSTMENT_TOLERANCE_DAYS} days, consistent with a business-day adjustment.`,
    });
  }
  if (described.couponPct !== null && terms.couponRatePct !== null && Math.abs(described.couponPct - terms.couponRatePct) > 1e-6) {
    issues.push({
      code: "COUPON_CONFLICT",
      severity: "REVIEW",
      label: "Coupon conflict",
      detail: `The source's security description ("${input.sourceSecurityDescription}") indicates a ${described.couponPct}% coupon, but the Securities Master holds ${terms.couponRatePct}%.`,
    });
  }

  // --- Cross-row integrity: one trade copied onto several securities -------
  if (input.tradeStatus !== "NOT_TRADED" && input.duplicatedVolumeWith && input.duplicatedVolumeWith.length > 0) {
    issues.push({
      code: "DUPLICATED_VOLUME",
      severity: "REVIEW",
      label: "Duplicated report volume",
      detail: `The source report shows exactly the same traded volume and trade count on ${iso(observationDate)} for ${input.duplicatedVolumeWith.join(", ")} — one trade cannot be both, so the row's price and volume are unreliable until checked against the source.`,
    });
  }

  // --- Price ↔ yield consistency -------------------------------------------
  const canSolve = input.cleanPrice !== null && observationDate.getTime() < terms.maturityDate.getTime();
  if (canSolve) {
    const solved = solveObservedYtm(terms, observationDate, input.cleanPrice!);
    if (!solved.ok) {
      issues.push({ code: "CALCULATION_FAILED", severity: "EXCLUDED", label: "Not computable", detail: `Yield cannot be solved from the observed price: ${solved.message}` });
    } else if (input.sourceYieldPct !== null) {
      const gapBps = Math.round((solved.ytmPct - input.sourceYieldPct) * 100);
      if (Math.abs(gapBps) > YIELD_MISMATCH_THRESHOLD_BPS) {
        issues.push({
          code: "YIELD_MISMATCH",
          severity: "REVIEW",
          label: "Yield mismatch",
          detail: `The source quotes ${input.sourceYieldPct.toFixed(2)}%, but the quoted price ${input.cleanPrice!.toFixed(4)} implies ${solved.ytmPct.toFixed(2)}% under the contractual terms (${Math.abs(gapBps)} bps apart; review threshold ${YIELD_MISMATCH_THRESHOLD_BPS} bps).`,
        });
      }
    }
  } else if (input.cleanPrice === null && input.sourceYieldPct === null) {
    issues.push({ code: "CALCULATION_FAILED", severity: "EXCLUDED", label: "No price or yield", detail: "The observation carries neither a price nor a yield." });
  } else if (terms.couponType === "FLOATING") {
    issues.push({ code: "CALCULATION_FAILED", severity: "EXCLUDED", label: "Unsupported terms", detail: "Floating-rate terms cannot be modelled — no yield can be derived." });
  }

  const status: ObservationQualityStatus = issues.some((i) => i.severity === "EXCLUDED") ? "EXCLUDED" : issues.some((i) => i.severity === "REVIEW") ? "REVIEW" : "VALID";
  return { status, analyticsEligible: status === "VALID", issues };
}

/** A traded observation, reduced to the fields the duplicate-volume check needs. */
export interface VolumeRow {
  securityKey: string;
  /** Short label used in the issue text (e.g. an instrument code). */
  label: string;
  issuerName: string;
  observationDate: string;
  volumeTradedGhs: number | null;
  numberOfTrades: number | null;
  tradeStatus: "TRADED" | "NOT_TRADED" | null;
}

/**
 * Source integrity check (M7.4 forensic finding). On 28 Aug 2026 GFIM's
 * CORPORATE sheet printed the identical volume (36,065 GHS, 1 trade) on
 * THREE different Ghana Cocoa Board bonds, with closing prices 99.16, 51.26
 * and 29.97 — a fill-down/copy error in the source, not three trades. Such
 * rows cannot be told apart from a genuine trade by price alone (there is no
 * source yield on the CORPORATE sheet to contradict them), so the evidence is
 * the duplication itself: the same non-round GHS amount and trade count on
 * two or more securities of one issuer on one day.
 *
 * Round amounts (multiples of 1,000 GHS) are excluded: two unrelated trades
 * of exactly 250,000 are an ordinary coincidence; two of 34,529,476 are not.
 * Returns, per `securityKey|date`, the OTHER securities sharing the volume.
 */
export function findDuplicatedVolumes(rows: VolumeRow[]): Map<string, string[]> {
  const groups = new Map<string, VolumeRow[]>();
  for (const r of rows) {
    if (r.tradeStatus === "NOT_TRADED" || r.volumeTradedGhs === null || r.numberOfTrades === null || r.volumeTradedGhs <= 0) continue;
    if (r.volumeTradedGhs % 1000 === 0) continue;
    const key = `${r.issuerName}|${r.observationDate}|${r.volumeTradedGhs}|${r.numberOfTrades}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out = new Map<string, string[]>();
  for (const group of groups.values()) {
    if (new Set(group.map((g) => g.securityKey)).size < 2) continue;
    for (const r of group) {
      out.set(
        `${r.securityKey}|${r.observationDate}`,
        group.filter((g) => g.securityKey !== r.securityKey).map((g) => g.label),
      );
    }
  }
  return out;
}
