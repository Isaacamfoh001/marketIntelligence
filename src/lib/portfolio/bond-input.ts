// ---------------------------------------------------------------------------
// Bond valuation-input resolver (M8.1 §7). Decides which observed yield — if
// any — a bond position may rest on, preserving M7's quality semantics exactly:
//
//   VALID + recent                    → usable, "Recent observed input"
//   VALID + stale                     → usable, "Stale observed input"
//   newer REVIEW + older VALID        → older VALID used, its own age/recency kept,
//                                       and the pending review is disclosed
//   REVIEW, no older VALID            → unavailable
//   EXCLUDED                          → never used automatically
//   NOT_TRADED / carried only         → unavailable
//   no observation                    → unavailable
//   matured / unsupported / conflicting terms → unavailable with the reason
//
// There are NO analyst overrides. The M7 quality engine has already classified
// every observation; this function only selects from its output
// (`latestReliableTrade` = the newest VALID, price-solved-at-its-own-date trade).
// ---------------------------------------------------------------------------

import { observationFreshness } from "../freshness";
import { observationAgeDays, type BondTerms, type SecurityLifecycle } from "../fixed-income";
import type { InputRecency, Unvalued } from "./types";

/** The slice of an M7 FixedIncomeSecurityRow the resolver needs — assembled by the portfolio query layer. */
export interface BondValuationSource {
  currency: string;
  status: "ACTIVE" | "MATURED" | "CALLED" | "DEFAULTED";
  lifecycle: SecurityLifecycle;
  terms: BondTerms;
  /** Human-readable evidence of any source-vs-master terms conflict (M7 REVIEW-severity terms issues). */
  termsConflicts: string[];
  /** Newest observation that passed every M7 quality check, with its yield solved at its own trade date. */
  latestReliableTrade: { date: string; cleanPrice: number | null; ytmPct: number } | null;
  /** The newest non-carried market observation and M7's quality verdict on it (null when there is none). */
  marketObservation: { date: string; status: "VALID" | "REVIEW" | "EXCLUDED"; issues: string[] } | null;
  /** The source only re-prints a carried (NOT_TRADED) price — no trade is recorded in our history. */
  carriedOnly: boolean;
}

export interface BondValuationInput {
  available: true;
  assetClass: "BOND";
  /** The last reliable OBSERVED yield (% p.a.), at its own observation date — never re-dated. */
  observedYtmPct: number;
  observationDate: string;
  ageDays: number;
  recency: InputRecency;
  /** The clean price the market actually traded at on `observationDate` (historical; not the rolled reference price). */
  observedCleanPrice: number | null;
  /** True when the yield came from the source's own quoted yield rather than a price solved by Korbly. */
  yieldFromSourceQuote: boolean;
  /** A newer observation exists but is withheld from use; disclosed so the analyst knows the input may be superseded. */
  pendingReview: { date: string; status: "REVIEW" | "EXCLUDED"; issues: string[] } | null;
}

export function resolveBondValuationInput(source: BondValuationSource, valuationDate: Date): BondValuationInput | Unvalued {
  const no = (code: Unvalued["code"], reason: string): Unvalued => ({ available: false, code, reason });

  if (source.currency !== "GHS") return no("NOT_GHS", `Only GHS instruments are supported (this one is ${source.currency}).`);
  if (source.lifecycle === "MATURED" || source.terms.maturityDate.getTime() <= valuationDate.getTime()) {
    return no("MATURED", "This bond has matured — it has no remaining cash flows, so it has no reference value (it is not zero).");
  }
  if (source.terms.couponType === "FLOATING") return no("FLOATING_RATE", "Floating-rate bonds cannot be valued — the future coupon reset path is unknown.");
  if (source.status === "CALLED" || source.status === "DEFAULTED") {
    return no("NOT_OUTSTANDING", `The Securities Master records this bond as ${source.status.toLowerCase()} — contractual cash flows cannot be assumed.`);
  }
  if (source.terms.couponType === "FIXED" && (source.terms.couponRatePct === null || source.terms.couponFrequency === null)) {
    return no("TERMS_UNSUPPORTED", "This fixed-rate bond is missing its coupon rate or frequency in the Securities Master.");
  }
  if (source.termsConflicts.length > 0) {
    return no("TERMS_CONFLICT", `The source and the Securities Master disagree on this bond's terms, so its cash flows are uncertain. ${source.termsConflicts.join(" ")}`);
  }

  const trade = source.latestReliableTrade;
  if (!trade) {
    const obs = source.marketObservation;
    if (obs?.status === "REVIEW") {
      return no("UNDER_REVIEW", `The only market observation (${obs.date}) is pending data-quality review and no earlier reliable trade exists. ${obs.issues.join(" ")}`.trim());
    }
    if (obs?.status === "EXCLUDED") {
      return no("OBSERVATION_EXCLUDED", `The latest observation (${obs.date}) is excluded as a usable market price and no earlier reliable trade exists. ${obs.issues.join(" ")}`.trim());
    }
    if (source.carriedOnly) {
      return no("NO_TRADE", "The source only re-prints a carried closing price for this bond; no actual trade is recorded, so there is no dated market yield.");
    }
    return no("NO_OBSERVATION", "No market observation has been imported for this bond.");
  }

  const age = observationAgeDays(trade.date, valuationDate) ?? 0;
  const recency: InputRecency = observationFreshness("WEEKLY", new Date(`${trade.date}T00:00:00.000Z`), valuationDate) === "CURRENT" ? "RECENT" : "STALE";
  const obs = source.marketObservation;
  const pendingReview = obs && obs.date > trade.date && obs.status !== "VALID" ? { date: obs.date, status: obs.status as "REVIEW" | "EXCLUDED", issues: obs.issues } : null;

  return {
    available: true,
    assetClass: "BOND",
    observedYtmPct: trade.ytmPct,
    observationDate: trade.date,
    ageDays: age,
    recency,
    observedCleanPrice: trade.cleanPrice,
    yieldFromSourceQuote: trade.cleanPrice === null,
    pendingReview,
  };
}
