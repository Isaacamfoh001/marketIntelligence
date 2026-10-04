// ---------------------------------------------------------------------------
// Fixed Income Intelligence layer (M7.3.2) — pure, presentation-neutral
// derivations over analytics that already exist. NOTHING here computes a new
// financial quantity: yields, tenors, spreads, benchmarks, freshness and
// quality assessments are all read from the M7.3.1 workspace. This module
// only decides how those existing facts are GROUPED and LABELLED so the
// landing page, the Yield Landscape, Compare and the security page tell the
// same story:
//
//   - which observations may be plotted (analytics-eligible only; anything
//     REVIEW/EXCLUDED is returned separately as `withheld`, never as a point),
//   - what market state a security is in (recent / stale / needs review /
//     carried price only / never quoted),
//   - whether a benchmark figure is an OBSERVED SPREAD (date-matched,
//     corporate actually traded) or a REFERENCE GOVERNMENT YIELD (context
//     only, no observed corporate spread) — the two are never interchangeable.
// ---------------------------------------------------------------------------

import { securityShortLabel } from "./format";
import { daysBetween } from "./cashflow";
import { observationAgeDays } from "./lifecycle";
import type { BenchmarkSelection } from "./benchmark";
import type { ComparableRow } from "./comparables";
import type { ObservationIssue } from "./observation-quality";
import type { SecurityLifecycle } from "./lifecycle";

export type MarketFreshness = "CURRENT" | "STALE" | "MISSING";
export type LandscapeGroup = "TBILL" | "GOVERNMENT" | "CORPORATE";

export const LANDSCAPE_GROUP_LABEL: Record<LandscapeGroup, string> = {
  TBILL: "Treasury bills",
  GOVERNMENT: "Government bonds",
  CORPORATE: "Corporate bonds",
};

// ---------------------------------------------------------------------------
// Input shape — structurally satisfied by the query layer's WorkspaceSecurity
// (kept structural so this module never imports the database layer).
// ---------------------------------------------------------------------------

export interface IntelligenceSecurity {
  instrumentCode: string;
  instrumentName: string;
  issuerName: string;
  classification: "SOVEREIGN" | "CORPORATE";
  couponRatePct: number | null;
  maturityDate: string;
  lifecycle: SecurityLifecycle;
  latestObservationDate: string | null;
  observationFreshness: MarketFreshness;
  observationAgeDays: number | null;
  analyticsEligible: boolean;
  analytics: {
    tenorDays: number;
    ytmPct: number | null;
    cleanPrice: number | null;
    observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null;
    ytmSource: "SOLVED_FROM_PRICE" | "SOURCE_QUOTED" | null;
    /** The source's own published yield, independent of the solved one (null when the source publishes none, as GFIM's CORPORATE sheet). */
    sourceQuotedYieldPct: number | null;
    quality: { status: "VALID" | "REVIEW" | "EXCLUDED"; issues: ObservationIssue[] } | null;
  };
  carriedPrice: { cleanPrice: number | null; asOf: string } | null;
  noTradeRecordedSince: string | null;
  termsIssues: ObservationIssue[];
  benchmark: BenchmarkSelection | null;
  spreadBps: number | null;
  currentBenchmark: BenchmarkSelection | null;
}

// ---------------------------------------------------------------------------
// Market state — the compact vocabulary used for badges everywhere.
// ---------------------------------------------------------------------------

export type MarketState = "RECENT" | "STALE" | "NEEDS_REVIEW" | "CARRIED_ONLY" | "NO_QUOTE";

export const MARKET_STATE_LABEL: Record<MarketState, string> = {
  RECENT: "Recent",
  STALE: "Stale",
  NEEDS_REVIEW: "Needs review",
  CARRIED_ONLY: "Carried price — not a quote",
  NO_QUOTE: "No market quote",
};

/**
 * The single state of a security's market information. A carried price is a
 * state of its own: it never counts as a quote, however recent the report
 * that re-printed it. A real observation that failed data-quality checks is
 * NEEDS_REVIEW — it is not "recent" even if it traded yesterday.
 */
export function describeMarketState(s: Pick<IntelligenceSecurity, "latestObservationDate" | "analyticsEligible" | "observationFreshness" | "noTradeRecordedSince">): MarketState {
  if (s.latestObservationDate) {
    if (!s.analyticsEligible) return "NEEDS_REVIEW";
    return s.observationFreshness === "CURRENT" ? "RECENT" : "STALE";
  }
  return s.noTradeRecordedSince ? "CARRIED_ONLY" : "NO_QUOTE";
}

// ---------------------------------------------------------------------------
// Benchmark semantics (M7.3.2 §8): observed spread ≠ reference yield.
// ---------------------------------------------------------------------------

interface BenchmarkFacts {
  yieldPct: number;
  label: string;
  date: string;
  kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET";
  tenorGapDays: number;
  isWideGap: boolean;
}

export type BenchmarkContext =
  /** Government securities are the benchmark itself — no spread applies. */
  | { type: "SOVEREIGN" }
  /** The corporate actually traded (reliably) and a date-matched sovereign observation exists: a real, dated spread. */
  | ({ type: "OBSERVED_SPREAD"; spreadBps: number; observationGapDays: number } & BenchmarkFacts)
  /** No reliable corporate observation: today's nearest-tenor government yield, as context for hypothetical scenarios ONLY. No spread exists. */
  | ({ type: "REFERENCE_ONLY" } & BenchmarkFacts)
  /** The corporate traded reliably but no sovereign observation lies within the date window: no spread. */
  | { type: "NO_DATE_MATCHED_BENCHMARK" }
  | { type: "UNAVAILABLE" };

function benchmarkFacts(b: BenchmarkSelection, labelOf: (code: string | null, fallback: string) => string): BenchmarkFacts {
  return {
    yieldPct: b.benchmark.yieldPct,
    label: labelOf(b.benchmark.instrumentCode, b.benchmark.instrumentLabel),
    date: b.benchmark.observationDate,
    kind: b.benchmark.observationKind,
    tenorGapDays: b.tenorGapDays,
    isWideGap: b.isWideGap,
  };
}

/** Builds a label resolver: a government bond's short label ("GoG 19.25% Jan-27") where the code is known, else the benchmark's own label (e.g. "91-Day T-Bill"). */
export function benchmarkLabeller(securities: Pick<IntelligenceSecurity, "instrumentCode" | "issuerName" | "couponRatePct" | "maturityDate">[]) {
  const byCode = new Map(securities.map((s) => [s.instrumentCode, s]));
  return (code: string | null, fallback: string) => {
    const sec = code ? byCode.get(code) : undefined;
    return sec ? securityShortLabel(sec.issuerName, sec.couponRatePct, sec.maturityDate) : fallback;
  };
}

export function describeBenchmarkContext(
  s: Pick<IntelligenceSecurity, "classification" | "lifecycle" | "analyticsEligible" | "benchmark" | "spreadBps" | "currentBenchmark">,
  labelOf: (code: string | null, fallback: string) => string,
): BenchmarkContext {
  if (s.classification === "SOVEREIGN") return { type: "SOVEREIGN" };
  if (s.analyticsEligible) {
    if (s.benchmark && s.spreadBps !== null) {
      return { type: "OBSERVED_SPREAD", spreadBps: s.spreadBps, observationGapDays: s.benchmark.observationGapDays, ...benchmarkFacts(s.benchmark, labelOf) };
    }
    return { type: "NO_DATE_MATCHED_BENCHMARK" };
  }
  if (s.currentBenchmark) return { type: "REFERENCE_ONLY", ...benchmarkFacts(s.currentBenchmark, labelOf) };
  return { type: "UNAVAILABLE" };
}

// ---------------------------------------------------------------------------
// Yield Landscape points
// ---------------------------------------------------------------------------

export interface LandscapePoint {
  /** instrumentCode (bonds) or `TBILL-<code>` (bills) — the same code space as the comparable universe. */
  id: string;
  group: LandscapeGroup;
  label: string;
  issuerName: string;
  /** Null for Treasury bills (no security page). */
  href: string | null;
  /**
   * Remaining tenor AT THE OBSERVATION: maturity date − observation date. This
   * is the x-coordinate. An observed yield describes the security as it was
   * when it traded, so measuring its tenor from today would plot a months-old
   * yield against a shorter life it did not have when it was observed. (A
   * T-bill's auction date → maturity is its full auction tenor.)
   */
  tenorAtObservationDays: number;
  /** Remaining tenor as of the valuation date — NOT plotted; used only to line the point up with the comparable universe, which is measured today. */
  tenorTodayDays: number;
  yieldPct: number;
  couponRatePct: number | null;
  maturityDate: string;
  observationDate: string;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET";
  /** CURRENT or STALE only — a point with no observation is never plotted. */
  freshness: "CURRENT" | "STALE";
  ageDays: number | null;
  cleanPrice: number | null;
  ytmSource: "SOLVED_FROM_PRICE" | "SOURCE_QUOTED" | null;
  /** Material (non-INFO) terms conflicts — scenario returns rely on these terms too, so they stay visible on the point. */
  termsConflict: string | null;
  benchmark: BenchmarkContext;
}

/** An outstanding security whose latest market observation is NOT plotted, with the reason — exclusions are inspectable, never silent. */
export interface WithheldObservation {
  id: string;
  group: LandscapeGroup;
  label: string;
  href: string;
  observationDate: string;
  status: "REVIEW" | "EXCLUDED";
  reason: string;
}

export interface YieldLandscape {
  points: LandscapePoint[];
  withheld: WithheldObservation[];
  /** Outstanding securities with no market observation to plot (carried price only, or never quoted) — counted, not drawn. */
  notPlotted: { carriedOnly: number; neverQuoted: number };
}

/** Whole days from an observation date to the security's maturity — the remaining tenor the market was pricing at that observation (never below 0). */
export function remainingTenorAtObservationDays(maturityDateIso: string, observationDateIso: string): number {
  return Math.max(0, daysBetween(new Date(`${observationDateIso}T00:00:00.000Z`), new Date(`${maturityDateIso}T00:00:00.000Z`)));
}

function materialIssues(issues: ObservationIssue[]): ObservationIssue[] {
  return issues.filter((i) => i.severity !== "INFO");
}

export function buildYieldLandscape(securities: IntelligenceSecurity[], bills: ComparableRow[], valuationDate: Date): YieldLandscape {
  const labelOf = benchmarkLabeller(securities);
  const points: LandscapePoint[] = [];
  const withheld: WithheldObservation[] = [];
  const notPlotted = { carriedOnly: 0, neverQuoted: 0 };

  for (const s of securities) {
    if (s.lifecycle === "MATURED") continue; // matured securities never appear in current views
    const label = securityShortLabel(s.issuerName, s.couponRatePct, s.maturityDate);
    const group: LandscapeGroup = s.classification === "SOVEREIGN" ? "GOVERNMENT" : "CORPORATE";
    const state = describeMarketState(s);

    if (state === "CARRIED_ONLY") notPlotted.carriedOnly++;
    else if (state === "NO_QUOTE") notPlotted.neverQuoted++;
    else if (state === "NEEDS_REVIEW") {
      const q = s.analytics.quality;
      const reasons = materialIssues(q?.issues ?? []).map((i) => i.label);
      withheld.push({
        id: s.instrumentCode,
        group,
        label,
        href: `/fixed-income/${encodeURIComponent(s.instrumentCode)}`,
        observationDate: s.latestObservationDate!,
        status: q?.status === "EXCLUDED" ? "EXCLUDED" : "REVIEW",
        reason: reasons.length > 0 ? reasons.join(", ") : "Yield not computable",
      });
    } else if (s.analytics.ytmPct !== null && s.analytics.observationKind) {
      const conflict = materialIssues(s.termsIssues).map((i) => i.label);
      points.push({
        id: s.instrumentCode,
        group,
        label,
        issuerName: s.issuerName,
        href: `/fixed-income/${encodeURIComponent(s.instrumentCode)}`,
        tenorAtObservationDays: remainingTenorAtObservationDays(s.maturityDate, s.latestObservationDate!),
        tenorTodayDays: s.analytics.tenorDays,
        yieldPct: s.analytics.ytmPct,
        couponRatePct: s.couponRatePct,
        maturityDate: s.maturityDate,
        observationDate: s.latestObservationDate!,
        observationKind: s.analytics.observationKind,
        freshness: state === "RECENT" ? "CURRENT" : "STALE",
        ageDays: s.observationAgeDays,
        cleanPrice: s.analytics.cleanPrice,
        ytmSource: s.analytics.ytmSource,
        termsConflict: conflict.length > 0 ? conflict.join(", ") : null,
        benchmark: describeBenchmarkContext(s, labelOf),
      });
    }
  }

  for (const b of bills) {
    if (b.instrumentType !== "TREASURY_BILL" || b.ytmPct === null || !b.observationDate || b.freshness === "MISSING") continue;
    points.push({
      id: b.instrumentCode,
      group: "TBILL",
      label: b.instrumentName.replace(" Treasury Bill", " T-bill"),
      issuerName: b.issuerName,
      href: null,
      tenorAtObservationDays: remainingTenorAtObservationDays(b.maturityDate, b.observationDate),
      tenorTodayDays: b.tenorDays,
      yieldPct: b.ytmPct,
      couponRatePct: null,
      maturityDate: b.maturityDate,
      observationDate: b.observationDate,
      observationKind: "AUCTION_PRIMARY",
      freshness: b.freshness,
      ageDays: observationAgeDays(b.observationDate, valuationDate),
      cleanPrice: null,
      ytmSource: null,
      termsConflict: null,
      benchmark: { type: "SOVEREIGN" },
    });
  }

  return { points, withheld, notPlotted };
}

// ---------------------------------------------------------------------------
// Market summary — factual counts for the landing page. No score is invented.
// ---------------------------------------------------------------------------

export interface SegmentSummary {
  /** Outstanding (non-matured) securities. */
  active: number;
  /** …with a reliable (analytics-eligible) observed yield. */
  reliable: number;
  /** …of which the observation is recent. */
  recent: number;
  /** …of which the observation is stale. */
  stale: number;
  needsReview: number;
  carriedOnly: number;
  neverQuoted: number;
  termsConflicts: number;
  maturingSoon: number;
  /** Latest real secondary-market trade date in the segment, with that security's freshness. */
  latestTrade: { date: string; freshness: MarketFreshness } | null;
}

export function summarizeSegment(securities: IntelligenceSecurity[]): SegmentSummary {
  const outstanding = securities.filter((s) => s.lifecycle !== "MATURED");
  const states = outstanding.map(describeMarketState);
  let latestTrade: SegmentSummary["latestTrade"] = null;
  for (const s of outstanding) {
    if (s.latestObservationDate && s.analytics.observationKind === "SECONDARY_MARKET" && (!latestTrade || s.latestObservationDate > latestTrade.date)) {
      latestTrade = { date: s.latestObservationDate, freshness: s.observationFreshness };
    }
  }
  return {
    active: outstanding.length,
    reliable: outstanding.filter((s) => s.analyticsEligible).length,
    recent: states.filter((x) => x === "RECENT").length,
    stale: states.filter((x) => x === "STALE").length,
    needsReview: states.filter((x) => x === "NEEDS_REVIEW").length,
    carriedOnly: states.filter((x) => x === "CARRIED_ONLY").length,
    neverQuoted: states.filter((x) => x === "NO_QUOTE").length,
    termsConflicts: outstanding.filter((s) => materialIssues(s.termsIssues).length > 0).length,
    maturingSoon: outstanding.filter((s) => s.lifecycle === "MATURING_SOON").length,
    latestTrade,
  };
}
