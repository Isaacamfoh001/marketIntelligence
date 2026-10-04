// ---------------------------------------------------------------------------
// Analyst queue (M7.4) — the evolution of "Where to look next". It answers
// "what deserves my attention next?" with factual groups; it never says what
// is attractive or what to buy. Every entry is a security plus the dated fact
// that put it on the list, and every rule is deterministic.
//
//   NEW MARKET ACTIVITY  — latest reliable trades inside the recency window
//   NEEDS INVESTIGATION  — terms conflicts, withheld observations, yields far
//                          from contemporaneous government trades, corporate
//                          yields BELOW the date-matched government
//                          observation, stale corporate observations
//   UPCOMING             — securities inside the maturity window
//   EVALUATE AN ISSUER   — corporate issuers, for the issuer workflow
// ---------------------------------------------------------------------------

import { formatIsoDate, formatPct, issuerShortName, securityShortLabel } from "./format";
import { describeMarketState, type MarketState } from "./landscape";
import { observationAgeDays } from "./lifecycle";
import { comparePeerYield, isUnusualVsPeers, RECENT_WINDOW_DAYS, type AnalystSecurity } from "./market-changes";
import { CURVE_MAX_AGE_DAYS, type YieldCurvePoint } from "./benchmark";

export interface QueueEntry {
  instrumentCode: string;
  label: string;
  href: string;
  state: MarketState;
  /** Dated factual lines, most important first. */
  facts: string[];
}

export interface AnalystQueue {
  newActivity: { entries: QueueEntry[]; more: number };
  needsInvestigation: { entries: QueueEntry[]; more: number };
  upcoming: { entries: QueueEntry[]; more: number };
  issuers: string[];
}

export const QUEUE_ENTRIES_PER_GROUP = 5;
export const UPCOMING_ENTRIES = 4;

const hrefFor = (code: string) => `/fixed-income/${encodeURIComponent(code)}`;

function entry(s: AnalystSecurity, facts: string[]): QueueEntry {
  return { instrumentCode: s.instrumentCode, label: securityShortLabel(s.issuerName, s.couponRatePct, s.maturityDate), href: hrefFor(s.instrumentCode), state: describeMarketState(s), facts };
}

function tradeSize(s: AnalystSecurity): string {
  const n = s.latestObservationNumberOfTrades;
  const v = s.latestObservationVolumeGhs;
  const parts = [n !== null ? `${n} trade${n === 1 ? "" : "s"}` : null, v !== null ? `GHS ${Math.round(v).toLocaleString("en-GB")}` : null].filter(Boolean);
  return parts.join(", ");
}

/** The reasons (each a dated fact) a security needs investigating. Empty = nothing to flag. */
export function investigationReasons(s: AnalystSecurity, sovereignPool: YieldCurvePoint[], valuationDate: Date): string[] {
  const reasons: string[] = [];
  const state = describeMarketState(s);

  const material = [...(s.analytics.quality?.issues ?? []), ...s.termsIssues].filter((i) => i.severity !== "INFO");
  const termsLabels = new Set(s.termsIssues.filter((i) => i.severity !== "INFO").map((i) => i.label));
  if (termsLabels.size > 0) reasons.push(`Source terms conflict with the securities master: ${[...termsLabels].join(", ")}.`);
  if (state === "NEEDS_REVIEW" && s.latestObservationDate) {
    const labels = [...new Set(material.filter((i) => !termsLabels.has(i.label)).map((i) => i.label))];
    reasons.push(`The ${formatIsoDate(s.latestObservationDate)} observation is withheld from analytics${labels.length > 0 ? `: ${labels.join(", ")}` : ""}.`);
  }

  if (s.analyticsEligible && s.latestObservationDate && s.analytics.ytmPct !== null) {
    // Only observations still current enough to belong on today's curve: a months-old print is already marked stale everywhere it appears.
    const withinCurveWindow = (observationAgeDays(s.latestObservationDate, valuationDate) ?? Infinity) <= CURVE_MAX_AGE_DAYS;
    if (s.classification === "SOVEREIGN" && s.analytics.observationKind === "SECONDARY_MARKET" && withinCurveWindow) {
      const peers = comparePeerYield(s.instrumentCode, s.latestObservationDate, s.analytics.ytmPct, sovereignPool);
      if (peers && isUnusualVsPeers(peers)) {
        reasons.push(
          `${formatPct(peers.yieldPct)} on ${formatIsoDate(s.latestObservationDate)} is ${Math.abs(peers.gapBps).toLocaleString("en-GB")} bps ${peers.gapBps > 0 ? "above" : "below"} the median (${formatPct(peers.medianPct)}) of ${peers.peerCount} other government bonds traded within ${peers.windowDays} days${tradeSize(s) ? ` (this trade: ${tradeSize(s)})` : ""}.`,
        );
      }
    }
    if (s.classification === "CORPORATE" && s.benchmark && s.spreadBps !== null && s.spreadBps < 0) {
      reasons.push(`Observed yield ${formatPct(s.analytics.ytmPct)} (${formatIsoDate(s.latestObservationDate)}) is ${Math.abs(s.spreadBps).toLocaleString("en-GB")} bps below the date-matched GoG observation.`);
    }
  }

  if (s.classification === "CORPORATE" && state === "STALE" && s.latestObservationDate) {
    reasons.push(`Last reliable trade ${formatIsoDate(s.latestObservationDate)} is ${observationAgeDays(s.latestObservationDate, valuationDate)} days old.`);
  }
  return reasons;
}

export function buildAnalystQueue(securities: AnalystSecurity[], sovereignPool: YieldCurvePoint[], valuationDate: Date): AnalystQueue {
  const outstanding = securities.filter((s) => s.lifecycle !== "MATURED");

  // --- New market activity -------------------------------------------------
  const recent = outstanding
    .filter((s) => s.analyticsEligible && s.latestObservationDate && s.analytics.observationKind === "SECONDARY_MARKET" && (observationAgeDays(s.latestObservationDate, valuationDate) ?? Infinity) <= RECENT_WINDOW_DAYS)
    .sort(
      (a, b) =>
        b.latestObservationDate!.localeCompare(a.latestObservationDate!) ||
        Number(b.classification === "CORPORATE") - Number(a.classification === "CORPORATE") ||
        (b.latestObservationVolumeGhs ?? 0) - (a.latestObservationVolumeGhs ?? 0) ||
        a.maturityDate.localeCompare(b.maturityDate),
    );
  const newActivity = recent.map((s) => entry(s, [`${formatPct(s.analytics.ytmPct!)} · traded ${formatIsoDate(s.latestObservationDate!)}${tradeSize(s) ? ` · ${tradeSize(s)}` : ""}`]));

  // --- Needs investigation -----------------------------------------------
  const flagged = outstanding
    .map((s) => ({ s, reasons: investigationReasons(s, sovereignPool, valuationDate) }))
    .filter((x) => x.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length || a.s.maturityDate.localeCompare(b.s.maturityDate));
  const needsInvestigation = flagged.map(({ s, reasons }) => entry(s, reasons));

  // --- Upcoming ------------------------------------------------------------
  const maturing = outstanding.filter((s) => s.lifecycle === "MATURING_SOON").sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  const upcoming = maturing.map((s) => {
    const days = s.analytics.tenorDays;
    const last = s.analyticsEligible && s.latestObservationDate ? `last reliable yield ${formatPct(s.analytics.ytmPct!)} on ${formatIsoDate(s.latestObservationDate)}` : "no reliable observed yield";
    return entry(s, [`Matures ${formatIsoDate(s.maturityDate)} (${days} day${days === 1 ? "" : "s"}) · ${last}`]);
  });

  const issuers = [...new Set(outstanding.filter((s) => s.classification === "CORPORATE").map((s) => s.issuerName))].sort((a, b) => issuerShortName(a).localeCompare(issuerShortName(b)));

  const cut = (all: QueueEntry[], n: number) => ({ entries: all.slice(0, n), more: Math.max(0, all.length - n) });
  return {
    newActivity: cut(newActivity, QUEUE_ENTRIES_PER_GROUP),
    needsInvestigation: cut(needsInvestigation, QUEUE_ENTRIES_PER_GROUP),
    upcoming: cut(upcoming, UPCOMING_ENTRIES),
    issuers,
  };
}
