// ---------------------------------------------------------------------------
// Security-level analyst decision support (M7.4). Built ONLY from facts the
// system already holds — observations, data-quality results, the benchmark
// context and trade history. It answers four questions for an analyst:
//
//   What do I know?              → market observation, relative-value context
//   What stands out?             → dated factual statements
//   What don't I know?           → data limitations that change interpretation
//   What should I investigate?   → prompts from deterministic rules
//
// It is NOT a recommendation: no statement says a security is attractive,
// cheap, safe or worth buying, and the prompts are questions, never advice.
// ---------------------------------------------------------------------------

import { daysBetween } from "./cashflow";
import { formatBps, formatIsoDate, formatPct } from "./format";
import { describeMarketState, type BenchmarkContext, type MarketState } from "./landscape";
import { LOOSE_DATE_MATCH_DAYS, MATERIAL_YIELD_MOVE_BPS, TRADE_COMPARISON_WINDOW_DAYS, isUnusualVsPeers, type AnalystSecurity, type PeerDispersion } from "./market-changes";

export interface DecisionSupportInput {
  security: AnalystSecurity & { benchmarkContext: BenchmarkContext };
  peer: PeerDispersion | null;
  /** Other outstanding bonds from the same issuer (for the issuer action). */
  issuerSiblingCount: number;
}

export interface MarketObservationFacts {
  state: MarketState;
  ytmPct: number | null;
  ytmSource: "SOLVED_FROM_PRICE" | "SOURCE_QUOTED" | null;
  cleanPrice: number | null;
  tradeDate: string | null;
  ageDays: number | null;
  /** Dates with a real trade in the history we hold (not a lifetime count). */
  tradeDays: number;
  firstTradeDate: string | null;
  lastTradeSize: { trades: number | null; volumeGhs: number | null } | null;
}

export interface DecisionAction {
  id: "compare" | "test-price" | "evidence" | "issuer";
  label: string;
  href: string;
}

export interface DecisionSupport {
  market: MarketObservationFacts;
  /** The benchmark context exactly as the rest of the UI shows it — an observed spread and a reference yield are never interchangeable. */
  relativeValue: BenchmarkContext;
  standsOut: string[];
  limitations: string[];
  questions: string[];
  actions: DecisionAction[];
}

export const MAX_QUESTIONS = 4;

export function buildDecisionSupport({ security: s, peer, issuerSiblingCount }: DecisionSupportInput): DecisionSupport {
  const state = describeMarketState(s);
  const reliable = s.analyticsEligible && s.latestObservationDate !== null;
  const ctx = s.benchmarkContext;
  const material = (issues: { severity: string }[]) => issues.some((i) => i.severity !== "INFO");
  const hasTermsConflict = material(s.termsIssues);
  const age = s.observationAgeDays;

  const market: MarketObservationFacts = {
    state,
    ytmPct: reliable ? s.analytics.ytmPct : null,
    ytmSource: reliable ? s.analytics.ytmSource : null,
    cleanPrice: reliable ? s.analytics.cleanPrice : null,
    tradeDate: s.latestObservationDate,
    ageDays: age,
    tradeDays: s.tradeHistory.tradeDays,
    firstTradeDate: s.tradeHistory.firstTradeDate,
    lastTradeSize: s.latestObservationDate ? { trades: s.latestObservationNumberOfTrades, volumeGhs: s.latestObservationVolumeGhs } : null,
  };

  // ------------------------------------------------------------ what stands out
  const standsOut: string[] = [];
  if (s.lifecycle === "MATURING_SOON") standsOut.push(`The security matures in ${s.analytics.tenorDays} day${s.analytics.tenorDays === 1 ? "" : "s"} (${formatIsoDate(s.maturityDate)}).`);

  if (state === "NO_QUOTE") standsOut.push("No reliable secondary-market trade is available — the security has never been observed trading in our data.");
  else if (state === "CARRIED_ONLY") {
    standsOut.push(`No reliable secondary-market trade is available. GFIM reports no trade since at least ${formatIsoDate(s.noTradeRecordedSince!)}; its published price is carried forward, not a market price.`);
  } else if (state === "NEEDS_REVIEW" && s.latestObservationDate) {
    const labels = [...new Set((s.analytics.quality?.issues ?? []).filter((i) => i.severity !== "INFO").map((i) => i.label))];
    standsOut.push(`The ${formatIsoDate(s.latestObservationDate)} trade is withheld from analytics${labels.length > 0 ? ` (${labels.join(", ")})` : ""}.`);
  } else if (state === "STALE" && age !== null) {
    standsOut.push(`The latest reliable trade is ${age} days old (${formatIsoDate(s.latestObservationDate!)}).`);
  }

  if (reliable && s.analytics.ytmPct !== null) {
    if (ctx.type === "OBSERVED_SPREAD") {
      standsOut.push(
        `This security's last observed yield was ${formatPct(s.analytics.ytmPct)} (${formatIsoDate(s.latestObservationDate!)}), compared with ${formatPct(ctx.yieldPct)} for the date-matched nearest-tenor GoG observation (${ctx.label}, ${formatIsoDate(ctx.date)}): an observed spread of ${formatBps(ctx.spreadBps)}.`,
      );
      if (ctx.spreadBps < 0) standsOut.push("The observed corporate yield is below the government observation. It is shown as observed — the benchmark is not credit-adjusted and no figure has been altered.");
      if (ctx.observationGapDays > LOOSE_DATE_MATCH_DAYS) standsOut.push(`The benchmark was observed ${ctx.observationGapDays} days from this trade (matching window ${TRADE_COMPARISON_WINDOW_DAYS} days), so the date match is loose.`);
      if (ctx.isWideGap) standsOut.push(`The benchmark's tenor differs from this security's by ${ctx.tenorGapDays} days; treat the spread as approximate.`);
    } else if (ctx.type === "NO_DATE_MATCHED_BENCHMARK") {
      standsOut.push(`No Government of Ghana observation lies within ${TRADE_COMPARISON_WINDOW_DAYS} days of this trade, so no observed spread can be calculated.`);
    }

    const prev = s.tradeHistory.previousReliableTrade;
    const latest = s.tradeHistory.latestReliableTrade;
    if (prev && latest && latest.date === s.latestObservationDate) {
      const gap = daysBetween(new Date(`${prev.date}T00:00:00.000Z`), new Date(`${latest.date}T00:00:00.000Z`));
      const bps = Math.round((latest.ytmPct - prev.ytmPct) * 100);
      if (gap <= TRADE_COMPARISON_WINDOW_DAYS && Math.abs(bps) >= MATERIAL_YIELD_MOVE_BPS[s.classification]) {
        standsOut.push(`The observed yield changed ${formatBps(bps)} from ${formatPct(prev.ytmPct)} on ${formatIsoDate(prev.date)} (${gap} day${gap === 1 ? "" : "s"} earlier).`);
      }
    }
    if (isUnusualVsPeers(peer) && peer) {
      standsOut.push(`The observed yield is ${Math.abs(peer.gapBps).toLocaleString("en-GB")} bps ${peer.gapBps > 0 ? "above" : "below"} the median (${formatPct(peer.medianPct)}) of ${peer.peerCount} other government bonds traded within ${peer.windowDays} days of it.`);
    }
  }
  if (hasTermsConflict) standsOut.push("The source terms conflict with the securities master; every figure uses the master terms.");

  // ------------------------------------------------------------ data limitations
  const limitations: string[] = [];
  if (s.lifecycle !== "MATURED") {
    limitations.push(
      state === "RECENT" ? "A recent trade is not an executable quote: no bid/ask or market depth is held." : "No executable quote: the price you could transact at today is unknown — only hypothetical purchase prices are available.",
    );
  }
  if (state === "CARRIED_ONLY" && s.carriedPrice?.cleanPrice != null) limitations.push(`The published price ${s.carriedPrice.cleanPrice.toFixed(2)} is carried from an earlier, unknown date and is not used anywhere.`);
  if (reliable && s.analytics.ytmSource === "SOLVED_FROM_PRICE" && s.analytics.sourceQuotedYieldPct === null) limitations.push("The source publishes no yield for this security; the observed yield is solved from the traded price under the securities-master terms.");
  if (reliable) limitations.push("Observed yields are gross of tax and transaction charges.");
  if (s.classification === "CORPORATE") {
    limitations.push("No credit assessment is incorporated.", "No issuer fundamentals are incorporated.");
  }
  if (s.lifecycle !== "MATURED" && (s.classification === "CORPORATE" || (ctx.type === "SOVEREIGN" && peer))) {
    limitations.push("The Government of Ghana benchmark universe is incomplete: the securities master appears to omit some current post-DDEP bonds.");
  }
  if (s.lifecycle !== "MATURED" && s.tradeHistory.tradeDays <= 3) {
    limitations.push(`Liquidity information is limited: ${s.tradeHistory.tradeDays === 0 ? "no trade" : `only ${s.tradeHistory.tradeDays} trade date${s.tradeHistory.tradeDays === 1 ? "" : "s"}`} on record${s.tradeHistory.firstTradeDate ? ` (first ${formatIsoDate(s.tradeHistory.firstTradeDate)})` : ""}.`);
  }

  // ------------------------------------------------------------ questions to investigate
  const questions: string[] = [];
  if (hasTermsConflict) questions.push("Which contractual terms are authoritative — the source's or the securities master's?");
  if (state === "NEEDS_REVIEW") questions.push("What does the original GFIM report say for this security on the observation date?");
  if (isUnusualVsPeers(peer)) questions.push("Was this an odd-lot or off-market trade? Is a trade of this size representative of where the bond would clear?");
  if (ctx.type === "OBSERVED_SPREAD") {
    questions.push(
      ctx.spreadBps >= 0
        ? "What credit or liquidity risk explains the yield difference from the government benchmark?"
        : "Why would the market price this issuer's yield below the government benchmark — support, structure, liquidity or timing differences?",
    );
  }
  if (state === "STALE" || state === "CARRIED_ONLY" || state === "NO_QUOTE") questions.push("What price or yield is currently executable?");
  if (s.lifecycle === "MATURING_SOON") questions.push("How does the remaining return compare with shorter-duration alternatives?");
  if (s.classification === "CORPORATE") questions.push("What do the issuer's financials say about its capacity to meet coupons and principal?");

  // ------------------------------------------------------------ actions
  const code = encodeURIComponent(s.instrumentCode);
  const actions: DecisionAction[] = [];
  if (s.lifecycle !== "MATURED") {
    actions.push({ id: "compare", label: "Compare securities", href: `/fixed-income/compare?codes=${code}` });
    actions.push({ id: "test-price", label: "Test purchase price", href: "#returns" });
  }
  actions.push({ id: "evidence", label: "View source evidence", href: "#evidence" });
  if (s.classification === "CORPORATE" && s.lifecycle !== "MATURED" && issuerSiblingCount > 0) {
    actions.push({ id: "issuer", label: `View issuer (${issuerSiblingCount + 1} bonds)`, href: `/fixed-income/compare?issuer=${encodeURIComponent(s.issuerName)}` });
  }

  return { market, relativeValue: ctx, standsOut, limitations, questions: questions.slice(0, MAX_QUESTIONS), actions };
}
