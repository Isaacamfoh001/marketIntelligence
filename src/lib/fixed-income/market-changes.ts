// ---------------------------------------------------------------------------
// "What changed?" and unusual-observation detection (M7.4) — pure and
// deterministic. Nothing here is generated, scored or ranked by a model: every
// item is a dated fact that can be re-derived from the stored observations,
// and every threshold is a documented constant with the evidence it came from.
// If the data cannot support a comparison (no earlier reliable trade, a gap too
// long to compare) the item is simply not produced — a change is never
// manufactured.
// ---------------------------------------------------------------------------

import { BENCHMARK_DATE_WINDOW_DAYS, type YieldCurvePoint } from "./benchmark";
import { daysBetween } from "./cashflow";
import { formatBps, formatIsoDate, formatPct, securityShortLabel } from "./format";
import { describeMarketState, type IntelligenceSecurity } from "./landscape";
import { MATURING_SOON_DAYS, observationAgeDays } from "./lifecycle";

// ---------------------------------------------------------------------------
// Input shapes (structural — the query layer's WorkspaceSecurity satisfies them)
// ---------------------------------------------------------------------------

export interface TradeSnapshot {
  date: string;
  cleanPrice: number | null;
  ytmPct: number;
}

export interface AnalystSecurity extends IntelligenceSecurity {
  tradeHistory: {
    tradeDays: number;
    reliableTradeDays: number;
    firstTradeDate: string | null;
    latestReliableTrade: TradeSnapshot | null;
    previousReliableTrade: TradeSnapshot | null;
  };
  latestObservationVolumeGhs: number | null;
  latestObservationNumberOfTrades: number | null;
}

export interface BillAuctionSummary {
  code: string;
  label: string;
  latest: { date: string; ratePct: number } | null;
  previous: { date: string; ratePct: number } | null;
}

// ---------------------------------------------------------------------------
// Documented thresholds
// ---------------------------------------------------------------------------

/** Recent = the WEEKLY freshness tolerance used everywhere for secondary bond trades (src/lib/freshness.ts: current within 10 calendar days). */
export const RECENT_WINDOW_DAYS = 10;

/**
 * Two trades are only compared when they are within the benchmark date window
 * (31 days): beyond it the market itself has changed (GoG Jan-27 traded at
 * 64.02% on 31 Jul and 19.12% on 13 Aug 2026), so a "move" would compare
 * different markets rather than describe a change.
 */
export const TRADE_COMPARISON_WINDOW_DAYS = BENCHMARK_DATE_WINDOW_DAYS;

/**
 * A change in observed yield between consecutive reliable trades (≤31 days
 * apart) is called MATERIAL only above the top quartile of such changes in
 * our own history. Measured over every consecutive-trade pair since Jul 2025
 * (191 sovereign, 411 corporate pairs): sovereign median 206 bps, 75th
 * percentile 515; corporate median 69 bps, 75th percentile 204. Rounded to
 * 500 and 200 bps. Thin, odd-lot trading makes smaller moves routine noise —
 * flagging them would bury the signal.
 */
export const MATERIAL_YIELD_MOVE_BPS = { SOVEREIGN: 500, CORPORATE: 200 } as const;

/**
 * A T-bill auction rate change is material above 50 bps. Measured over every
 * week-on-week change in the three bill tenors: median 8–9 bps, 75th
 * percentile 17–38 bps, 90th percentile 87–105 bps.
 */
export const MATERIAL_BILL_MOVE_BPS = 50;

/** A bill auction is "recent" for this purpose within one weekly cycle plus the weekly tolerance. */
export const BILL_RECENT_WINDOW_DAYS = 14;

/** A security "just became stale" when its last reliable trade is between the recency tolerance and this many days beyond it. */
export const JUST_STALE_WINDOW_DAYS = 7;

/**
 * Peer-dispersion check: an observed government yield is UNUSUAL when it sits
 * at least this far from the median of other government trades dated within
 * ±PEER_WINDOW_DAYS. 1,000 bps is the 90th percentile of consecutive-trade
 * sovereign moves (1,053 bps) — i.e. well beyond ordinary thin-market noise.
 * The observation is KEPT and shown; this only marks it for investigation.
 */
export const UNUSUAL_PEER_GAP_BPS = 1000;
export const PEER_WINDOW_DAYS = 7;
export const MIN_PEERS = 3;

/** Half the benchmark window: a benchmark observed further than this from the trade is called loosely date-matched in the UI. */
export const LOOSE_DATE_MATCH_DAYS = Math.floor(BENCHMARK_DATE_WINDOW_DAYS / 2);

export const MAX_CHANGES = 5;

// ---------------------------------------------------------------------------
// Peer dispersion
// ---------------------------------------------------------------------------

export interface PeerDispersion {
  yieldPct: number;
  medianPct: number;
  /** yield − median, in bps. */
  gapBps: number;
  peerCount: number;
  windowDays: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compares a government observation with OTHER government bond trades dated
 * within ±PEER_WINDOW_DAYS (one yield per peer instrument — its closest in
 * time). Null when fewer than MIN_PEERS peers traded: no median is then
 * meaningful and none is invented.
 */
export function comparePeerYield(instrumentCode: string, observationDate: string, yieldPct: number, pool: YieldCurvePoint[]): PeerDispersion | null {
  const byPeer = new Map<string, { gap: number; yieldPct: number }>();
  for (const p of pool) {
    if (!p.isGovernmentBond || p.observationKind !== "SECONDARY_MARKET" || !p.instrumentCode || p.instrumentCode === instrumentCode) continue;
    const gap = Math.abs(daysBetween(new Date(`${observationDate}T00:00:00.000Z`), new Date(`${p.observationDate}T00:00:00.000Z`)));
    if (gap > PEER_WINDOW_DAYS) continue;
    const current = byPeer.get(p.instrumentCode);
    if (!current || gap < current.gap) byPeer.set(p.instrumentCode, { gap, yieldPct: p.yieldPct });
  }
  if (byPeer.size < MIN_PEERS) return null;
  const medianPct = median([...byPeer.values()].map((v) => v.yieldPct));
  return { yieldPct, medianPct, gapBps: Math.round((yieldPct - medianPct) * 100), peerCount: byPeer.size, windowDays: PEER_WINDOW_DAYS };
}

export function isUnusualVsPeers(d: PeerDispersion | null): boolean {
  return d !== null && Math.abs(d.gapBps) >= UNUSUAL_PEER_GAP_BPS;
}

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

export type ChangeKind = "DATA_QUALITY" | "YIELD_MOVE" | "TBILL_AUCTION" | "TBILL_STALE" | "TRADE_AFTER_GAP" | "NEW_CORPORATE_TRADE" | "BECAME_STALE" | "ENTERED_MATURITY_WINDOW";

export interface ChangeItem {
  id: string;
  kind: ChangeKind;
  /** The date the change occurred (a trade/auction date) — always shown with the item. */
  eventDate: string;
  headline: string;
  /** One line of supporting context (trade size, previous trade, caveat). */
  detail: string | null;
  /** Security page for the evidence, when the item concerns one security. */
  href: string | null;
  tone: "neutral" | "caution";
  /** Lower sorts first. */
  priority: number;
}

const hrefFor = (code: string) => `/fixed-income/${encodeURIComponent(code)}`;
const labelOf = (s: Pick<IntelligenceSecurity, "issuerName" | "couponRatePct" | "maturityDate">) => securityShortLabel(s.issuerName, s.couponRatePct, s.maturityDate);
const ghs = (v: number) => `GHS ${Math.round(v).toLocaleString("en-GB")}`;

function sizeText(s: AnalystSecurity): string | null {
  const n = s.latestObservationNumberOfTrades;
  const v = s.latestObservationVolumeGhs;
  if (n === null && v === null) return null;
  return `Last trade: ${n !== null ? `${n} trade${n === 1 ? "" : "s"}` : ""}${n !== null && v !== null ? ", " : ""}${v !== null ? ghs(v) : ""}.`;
}

function joinLabels(labels: string[], max = 3): string {
  return labels.length <= max ? labels.join(", ") : `${labels.slice(0, max).join(", ")} +${labels.length - max} more`;
}

export function buildWhatChanged(securities: AnalystSecurity[], bills: BillAuctionSummary[], valuationDate: Date): ChangeItem[] {
  const valuationIso = valuationDate.toISOString().slice(0, 10);
  const items: ChangeItem[] = [];
  const outstanding = securities.filter((s) => s.lifecycle !== "MATURED");
  const stale: AnalystSecurity[] = [];
  const entering: AnalystSecurity[] = [];

  for (const s of outstanding) {
    const label = labelOf(s);
    const obsDate = s.latestObservationDate;
    const age = obsDate ? observationAgeDays(obsDate, valuationDate) : null;
    const state = describeMarketState(s);

    if (state === "NEEDS_REVIEW" && obsDate && age !== null && age <= RECENT_WINDOW_DAYS) {
      const reasons = [...new Set((s.analytics.quality?.issues ?? []).filter((i) => i.severity !== "INFO").map((i) => i.label))];
      items.push({
        id: `dq-${s.instrumentCode}`,
        kind: "DATA_QUALITY",
        eventDate: obsDate,
        headline: `${label}: the ${formatIsoDate(obsDate)} observation was withheld from analytics.`,
        detail: reasons.length > 0 ? `Data check: ${reasons.join(", ")}.` : "Yield could not be computed.",
        href: hrefFor(s.instrumentCode),
        tone: "caution",
        priority: 1,
      });
    }

    const latest = s.tradeHistory.latestReliableTrade;
    const isMarketObservation = latest && s.analyticsEligible && latest.date === obsDate;
    if (isMarketObservation && age !== null) {
      const prev = s.tradeHistory.previousReliableTrade;
      const gap = prev ? daysBetween(new Date(`${prev.date}T00:00:00.000Z`), new Date(`${latest.date}T00:00:00.000Z`)) : null;
      const comparable = prev !== null && gap !== null && gap <= TRADE_COMPARISON_WINDOW_DAYS;
      const deltaBps = comparable ? Math.round((latest.ytmPct - prev.ytmPct) * 100) : null;
      const threshold = MATERIAL_YIELD_MOVE_BPS[s.classification];

      if (age <= RECENT_WINDOW_DAYS) {
        if (comparable && deltaBps !== null && Math.abs(deltaBps) >= threshold) {
          items.push({
            id: `move-${s.instrumentCode}`,
            kind: "YIELD_MOVE",
            eventDate: latest.date,
            headline: `${label}: observed yield ${formatPct(latest.ytmPct)} on ${formatIsoDate(latest.date)}, ${formatBps(deltaBps)} versus ${formatPct(prev.ytmPct)} on ${formatIsoDate(prev.date)}.`,
            detail: [sizeText(s), `Previous reliable trade ${gap} day${gap === 1 ? "" : "s"} earlier. Thin trading moves yields; check trade size before reading this as a market move.`].filter(Boolean).join(" "),
            href: hrefFor(s.instrumentCode),
            tone: "neutral",
            priority: 2 + 1 / (1 + Math.abs(deltaBps)), // larger moves first within the tier
          });
        } else if (!comparable) {
          items.push({
            id: `gap-${s.instrumentCode}`,
            kind: "TRADE_AFTER_GAP",
            eventDate: latest.date,
            headline: prev
              ? `${label} traded on ${formatIsoDate(latest.date)} at ${formatPct(latest.ytmPct)} — its first reliable trade since ${formatIsoDate(prev.date)} (${gap} days).`
              : `${label} traded on ${formatIsoDate(latest.date)} at ${formatPct(latest.ytmPct)} — the first reliable trade in our history.`,
            detail: [sizeText(s), prev ? `Previous reliable yield ${formatPct(prev.ytmPct)}; the gap is too long to call the difference a move.` : null].filter(Boolean).join(" ") || null,
            href: hrefFor(s.instrumentCode),
            tone: "neutral",
            priority: 4 + (s.classification === "CORPORATE" ? 0 : 0.5),
          });
        } else if (s.classification === "CORPORATE") {
          items.push({
            id: `corp-${s.instrumentCode}`,
            kind: "NEW_CORPORATE_TRADE",
            eventDate: latest.date,
            headline: `${label} traded on ${formatIsoDate(latest.date)}: observed yield ${formatPct(latest.ytmPct)} (${formatBps(deltaBps!)} versus ${formatIsoDate(prev.date)}).`,
            detail: sizeText(s),
            href: hrefFor(s.instrumentCode),
            tone: "neutral",
            priority: 3,
          });
        }
      } else if (age > RECENT_WINDOW_DAYS && age <= RECENT_WINDOW_DAYS + JUST_STALE_WINDOW_DAYS) {
        stale.push(s);
      }
    }

    const tenor = s.analytics.tenorDays;
    if (tenor > MATURING_SOON_DAYS - JUST_STALE_WINDOW_DAYS && tenor <= MATURING_SOON_DAYS) entering.push(s);
  }

  if (stale.length > 0) {
    const newest = stale.map((s) => s.latestObservationDate!).sort().reverse()[0];
    items.push({
      id: "stale",
      kind: "BECAME_STALE",
      eventDate: newest,
      headline: `${stale.length} bond${stale.length === 1 ? "" : "s"} became stale in the last ${JUST_STALE_WINDOW_DAYS} days — no reliable trade for more than ${RECENT_WINDOW_DAYS} days.`,
      detail: `${joinLabels(stale.map((s) => `${labelOf(s)} (last ${formatIsoDate(s.latestObservationDate!)})`))}.`,
      href: null,
      tone: "neutral",
      priority: 5,
    });
  }
  if (entering.length > 0) {
    items.push({
      id: "maturity-window",
      kind: "ENTERED_MATURITY_WINDOW",
      eventDate: valuationIso,
      headline: `${entering.length} bond${entering.length === 1 ? "" : "s"} entered the ${MATURING_SOON_DAYS}-day maturity window in the last ${JUST_STALE_WINDOW_DAYS} days.`,
      detail: `${joinLabels(entering.map((s) => `${labelOf(s)} (matures ${formatIsoDate(s.maturityDate)})`))}.`,
      href: null,
      tone: "neutral",
      priority: 6,
    });
  }

  // --- Treasury-bill auctions ------------------------------------------------
  const withLatest = bills.filter((b) => b.latest !== null);
  if (withLatest.length > 0) {
    const latestDate = withLatest.map((b) => b.latest!.date).sort().reverse()[0];
    const auctionAge = observationAgeDays(latestDate, valuationDate) ?? 0;
    const moves = withLatest
      .filter((b) => b.previous !== null)
      .map((b) => ({ b, bps: Math.round((b.latest!.ratePct - b.previous!.ratePct) * 100) }));
    const moveText = moves.map(({ b, bps }) => `${b.label} ${formatPct(b.latest!.ratePct)} (${formatBps(bps)} vs ${formatIsoDate(b.previous!.date)})`).join(" · ");
    if (auctionAge <= BILL_RECENT_WINDOW_DAYS && moves.some((m) => Math.abs(m.bps) >= MATERIAL_BILL_MOVE_BPS)) {
      items.push({
        id: "tbill",
        kind: "TBILL_AUCTION",
        eventDate: latestDate,
        headline: `Treasury-bill auction of ${formatIsoDate(latestDate)}: ${moveText}.`,
        detail: null,
        href: "/macro-rates",
        tone: "neutral",
        priority: 2.5,
      });
    } else if (auctionAge > RECENT_WINDOW_DAYS) {
      items.push({
        id: "tbill-stale",
        kind: "TBILL_STALE",
        eventDate: latestDate,
        headline: `No Treasury-bill auction in our data since ${formatIsoDate(latestDate)} (${auctionAge} days).`,
        detail: moves.length > 0 ? `That auction: ${moveText}.` : null,
        href: "/macro-rates",
        tone: "caution",
        priority: 3.5,
      });
    }
  }

  // Cap each kind so one noisy category cannot crowd out the others, then keep the top MAX_CHANGES.
  const perKind = new Map<ChangeKind, number>();
  return items
    .sort((a, b) => a.priority - b.priority || b.eventDate.localeCompare(a.eventDate) || a.id.localeCompare(b.id))
    .filter((i) => {
      const n = (perKind.get(i.kind) ?? 0) + 1;
      perKind.set(i.kind, n);
      return n <= 2;
    })
    .slice(0, MAX_CHANGES);
}
