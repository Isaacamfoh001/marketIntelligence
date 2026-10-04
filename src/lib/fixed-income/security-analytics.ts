// ---------------------------------------------------------------------------
// Combines a security's contractual terms with its latest market
// observation into one analytics bundle — the single place Security
// Detail, Compare, and Find Alternatives all derive YTM/duration/DV01 from,
// so the three views can never disagree (M7 §19's "Fixed Income Data →
// Fixed Income Analytics → Security Analysis → ... → UI" pipeline).
//
// An observation may supply a clean price, a source-quoted yield, or both
// (M7 §5). When a price is present it is always preferred and YTM is
// SOLVED from it (the more informative, price-implied figure); when only a
// yield is published (no price), that yield is used directly as YTM
// without inventing a price to back it out of — `ytmSource` always says
// which happened, so a UI never presents one as the other.
//
// M7.3.1 — two corrections:
//   1. The observed YTM is solved AS OF THE OBSERVATION DATE (the yield the
//      market actually traded at). Solving a months-old price as of today
//      applies it to a shorter remaining life and different accrued
//      interest, which manufactured yields such as ~47% for a GoG bond that
//      really traded at 30.15% on 2 Feb 2026. Duration/DV01 are still
//      measured at the valuation date, at that observed yield.
//   2. Every observation carries a deterministic quality assessment
//      (observation-quality.ts). Only `quality.analyticsEligible`
//      observations may feed derived analytics; the rest stay visible with
//      their evidence.
// ---------------------------------------------------------------------------

import { computeDuration, type DurationResult } from "./duration";
import { computeCurrentYield } from "./yield";
import { daysBetween } from "./cashflow";
import { assessObservationQuality, solveObservedYtm, type ObservationQuality } from "./observation-quality";
import type { BondTerms, FixedIncomeUnavailableReason } from "./types";

export type ObservationKind = "AUCTION_PRIMARY" | "SECONDARY_MARKET";

export interface ObservationInput {
  observationDate: Date;
  cleanPrice: number | null;
  sourceYieldPct: number | null;
  observationKind: ObservationKind;
  /** M7.3.1 — null when the source doesn't report trade activity. Defaults to null when omitted. */
  tradeStatus?: "TRADED" | "NOT_TRADED" | null;
  sourceMaturityDate?: Date | null;
  sourceSecurityDescription?: string | null;
}

export type YtmSource = "SOLVED_FROM_PRICE" | "SOURCE_QUOTED";

export interface SecurityAnalytics {
  isMatured: boolean;
  tenorDays: number;
  cleanPrice: number | null;
  /** Accrued interest and dirty price AT THE OBSERVATION DATE (the settlement the observed price relates to). */
  accruedInterest: number | null;
  dirtyPrice: number | null;
  currentYieldPct: number | null;
  /** Observed yield to maturity as of the observation date — see module header. */
  ytmPct: number | null;
  ytmSource: YtmSource | null;
  /**
   * The source's OWN published yield (e.g. GFIM's "CLOSING YIELD" column),
   * independent of `ytmPct` — populated whenever the observation carries
   * one, even when a price was ALSO present and preferred for `ytmPct`
   * (M7.2 §8: the Jerome workflow must be able to show both the engine's
   * own price-solved YTM and the source's own quoted yield side by side,
   * never silently picking one and discarding the other).
   */
  sourceQuotedYieldPct: number | null;
  /** Which kind of observation the YTM/price/yield above is based on — null only when there is no observation at all. Never conflate an auction clearing rate with a secondary-market trade (M7.1 §8). */
  observationKind: ObservationKind | null;
  observationDate: string | null;
  /** Data-quality assessment of the observation (M7.3.1) — null when there is no observation. */
  quality: ObservationQuality | null;
  macaulayDurationYears: number | null;
  modifiedDurationYears: number | null;
  dv01: number | null;
  convexityYears2: number | null;
  unavailableReason: FixedIncomeUnavailableReason | null;
  unavailableMessage: string | null;
}

function emptyAnalytics(tenorDays: number, isMatured: boolean, reason: FixedIncomeUnavailableReason, message: string): SecurityAnalytics {
  return {
    isMatured,
    tenorDays,
    cleanPrice: null,
    accruedInterest: null,
    dirtyPrice: null,
    currentYieldPct: null,
    ytmPct: null,
    ytmSource: null,
    sourceQuotedYieldPct: null,
    observationKind: null,
    observationDate: null,
    quality: null,
    macaulayDurationYears: null,
    modifiedDurationYears: null,
    dv01: null,
    convexityYears2: null,
    unavailableReason: reason,
    unavailableMessage: message,
  };
}

export function buildSecurityAnalytics(terms: BondTerms, observation: ObservationInput | null, settlementDate: Date): SecurityAnalytics {
  const isMatured = terms.maturityDate.getTime() <= settlementDate.getTime();
  const tenorDays = Math.max(0, daysBetween(settlementDate, terms.maturityDate));

  if (isMatured) {
    return emptyAnalytics(0, true, "MATURED", "This security's maturity date has passed — contractual analytics are no longer applicable.");
  }
  if (!observation) {
    return emptyAnalytics(tenorDays, false, "MISSING_MARKET_DATA", "No market observation (price or yield) has been imported for this security yet.");
  }

  const quality = assessObservationQuality({
    terms,
    observationDate: observation.observationDate,
    tradeStatus: observation.tradeStatus ?? null,
    cleanPrice: observation.cleanPrice,
    sourceYieldPct: observation.sourceYieldPct,
    sourceMaturityDate: observation.sourceMaturityDate ?? null,
    sourceSecurityDescription: observation.sourceSecurityDescription ?? null,
  });

  let ytmPct: number | null = null;
  let ytmSource: YtmSource | null = null;
  let accruedInterest: number | null = null;
  let dirtyPrice: number | null = null;
  let currentYieldPct: number | null = null;

  // A carried (NOT_TRADED) price has no date of its own, so no yield is implied from it.
  if (observation.tradeStatus !== "NOT_TRADED") {
    if (observation.cleanPrice !== null) {
      const solved = solveObservedYtm(terms, observation.observationDate, observation.cleanPrice);
      if (solved.ok) {
        accruedInterest = solved.accruedInterest;
        dirtyPrice = observation.cleanPrice + solved.accruedInterest;
        ytmPct = solved.ytmPct;
        ytmSource = "SOLVED_FROM_PRICE";
      }
      const currentYieldResult = computeCurrentYield(terms, observation.cleanPrice);
      if (currentYieldResult.ok) currentYieldPct = currentYieldResult.currentYieldPct;
    } else if (observation.sourceYieldPct !== null) {
      ytmPct = observation.sourceYieldPct;
      ytmSource = "SOURCE_QUOTED";
    }
  }

  let duration: DurationResult | null = null;
  if (ytmPct !== null) {
    const durationResult = computeDuration(terms, settlementDate, ytmPct);
    if (durationResult.ok) duration = durationResult;
  }

  const base = {
    isMatured: false,
    tenorDays,
    cleanPrice: observation.cleanPrice,
    sourceQuotedYieldPct: observation.sourceYieldPct,
    observationKind: observation.observationKind,
    observationDate: observation.observationDate.toISOString().slice(0, 10),
    quality,
  };

  if (ytmPct === null && duration === null) {
    return {
      ...emptyAnalytics(
        tenorDays,
        false,
        "MISSING_MARKET_DATA",
        observation.tradeStatus === "NOT_TRADED"
          ? "The source reports no trade — its closing price is carried forward from an earlier, unknown date, so no market yield is implied."
          : "This observation has neither a usable price nor yield for this instrument type.",
      ),
      ...base,
    };
  }

  return {
    ...base,
    accruedInterest,
    dirtyPrice,
    currentYieldPct,
    ytmPct,
    ytmSource,
    macaulayDurationYears: duration?.macaulayDurationYears ?? null,
    modifiedDurationYears: duration?.modifiedDurationYears ?? null,
    dv01: duration?.dv01 ?? null,
    convexityYears2: duration?.convexityYears2 ?? null,
    unavailableReason: null,
    unavailableMessage: null,
  };
}
