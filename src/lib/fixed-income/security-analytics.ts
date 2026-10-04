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
// ---------------------------------------------------------------------------

import { computeAccruedInterest, cleanToDirty } from "./accrued";
import { computeDuration, type DurationResult } from "./duration";
import { computeCurrentYield, computeYtm } from "./yield";
import { daysBetween } from "./cashflow";
import type { BondTerms, FixedIncomeUnavailableReason } from "./types";

export type ObservationKind = "AUCTION_PRIMARY" | "SECONDARY_MARKET";

export interface ObservationInput {
  observationDate: Date;
  cleanPrice: number | null;
  sourceYieldPct: number | null;
  observationKind: ObservationKind;
}

export type YtmSource = "SOLVED_FROM_PRICE" | "SOURCE_QUOTED";

export interface SecurityAnalytics {
  isMatured: boolean;
  tenorDays: number;
  cleanPrice: number | null;
  accruedInterest: number | null;
  dirtyPrice: number | null;
  currentYieldPct: number | null;
  ytmPct: number | null;
  ytmSource: YtmSource | null;
  /** Which kind of observation the YTM/price/yield above is based on — null only when there is no observation at all. Never conflate an auction clearing rate with a secondary-market trade (M7.1 §8). */
  observationKind: ObservationKind | null;
  observationDate: string | null;
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
    observationKind: null,
    observationDate: null,
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

  let ytmPct: number | null = null;
  let ytmSource: YtmSource | null = null;
  let accruedInterest: number | null = null;
  let dirtyPrice: number | null = null;
  let currentYieldPct: number | null = null;

  if (observation.cleanPrice !== null) {
    const accruedResult = computeAccruedInterest(terms, settlementDate);
    if (accruedResult.ok) {
      accruedInterest = accruedResult.accruedInterest;
      dirtyPrice = cleanToDirty(observation.cleanPrice, accruedInterest);
      const ytmResult = computeYtm(terms, settlementDate, dirtyPrice);
      if (ytmResult.ok) {
        ytmPct = ytmResult.ytmPct;
        ytmSource = "SOLVED_FROM_PRICE";
      }
    }
    const currentYieldResult = computeCurrentYield(terms, observation.cleanPrice);
    if (currentYieldResult.ok) currentYieldPct = currentYieldResult.currentYieldPct;
  } else if (observation.sourceYieldPct !== null) {
    ytmPct = observation.sourceYieldPct;
    ytmSource = "SOURCE_QUOTED";
  }

  let duration: DurationResult | null = null;
  if (ytmPct !== null) {
    const durationResult = computeDuration(terms, settlementDate, ytmPct);
    if (durationResult.ok) duration = durationResult;
  }

  if (ytmPct === null && duration === null) {
    return {
      ...emptyAnalytics(tenorDays, false, "MISSING_MARKET_DATA", "This observation has neither a usable price nor yield for this instrument type."),
      cleanPrice: observation.cleanPrice,
    };
  }

  return {
    isMatured: false,
    tenorDays,
    cleanPrice: observation.cleanPrice,
    accruedInterest,
    dirtyPrice,
    currentYieldPct,
    ytmPct,
    ytmSource,
    observationKind: observation.observationKind,
    observationDate: observation.observationDate.toISOString().slice(0, 10),
    macaulayDurationYears: duration?.macaulayDurationYears ?? null,
    modifiedDurationYears: duration?.modifiedDurationYears ?? null,
    dv01: duration?.dv01 ?? null,
    convexityYears2: duration?.convexityYears2 ?? null,
    unavailableReason: null,
    unavailableMessage: null,
  };
}
