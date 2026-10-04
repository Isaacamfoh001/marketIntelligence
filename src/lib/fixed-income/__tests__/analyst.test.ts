import { describe, it, expect } from "vitest";
import { formatIsoDate } from "../format";
import { buildWhatChanged, comparePeerYield, isUnusualVsPeers, MATERIAL_YIELD_MOVE_BPS, type AnalystSecurity, type BillAuctionSummary } from "../market-changes";
import { buildAnalystQueue, investigationReasons } from "../analyst-queue";
import { buildDecisionSupport } from "../decision-support";
import { describeBenchmarkContext, benchmarkLabeller } from "../landscape";
import type { BenchmarkSelection, YieldCurvePoint } from "../benchmark";

const VALUATION = new Date("2026-10-04T00:00:00.000Z");

type Over = Omit<Partial<AnalystSecurity>, "analytics" | "tradeHistory"> & { analytics?: Partial<AnalystSecurity["analytics"]>; tradeHistory?: Partial<AnalystSecurity["tradeHistory"]> };

function sec(o: Over = {}): AnalystSecurity {
  const { analytics, tradeHistory, ...rest } = o;
  return {
    instrumentCode: "CORP1",
    instrumentName: "Acme Bond",
    issuerName: "Acme Plc",
    classification: "CORPORATE",
    couponRatePct: 20,
    maturityDate: "2028-01-01",
    lifecycle: "ACTIVE",
    latestObservationDate: "2026-10-01",
    observationFreshness: "CURRENT",
    observationAgeDays: 3,
    analyticsEligible: true,
    analytics: { tenorDays: 454, ytmPct: 21, cleanPrice: 99, observationKind: "SECONDARY_MARKET", ytmSource: "SOLVED_FROM_PRICE", sourceQuotedYieldPct: null, quality: { status: "VALID", issues: [] }, ...analytics },
    carriedPrice: null,
    noTradeRecordedSince: null,
    termsIssues: [],
    benchmark: null,
    spreadBps: null,
    currentBenchmark: null,
    latestObservationVolumeGhs: 500000,
    latestObservationNumberOfTrades: 2,
    tradeHistory: {
      tradeDays: 20,
      reliableTradeDays: 20,
      firstTradeDate: "2025-08-01",
      latestReliableTrade: { date: "2026-10-01", cleanPrice: 99, ytmPct: 21 },
      previousReliableTrade: { date: "2026-09-30", cleanPrice: 99.1, ytmPct: 20.9 },
      ...tradeHistory,
    },
    ...rest,
  };
}

const gov = (o: Over = {}) => sec({ instrumentCode: "GOG1", classification: "SOVEREIGN", issuerName: "Government of Ghana", couponRatePct: 19.5, ...o });
const NO_BILLS: BillAuctionSummary[] = [];
const changes = (s: AnalystSecurity[], bills = NO_BILLS) => buildWhatChanged(s, bills, VALUATION);

describe("buildWhatChanged — deterministic, dated, never manufactured (M7.4 §D)", () => {
  it("reports a material yield move between consecutive reliable trades, with both dates and the trade size", () => {
    const [item] = changes([
      gov({
        analytics: { ytmPct: 20.49 },
        latestObservationDate: "2026-09-30",
        tradeHistory: { latestReliableTrade: { date: "2026-09-30", cleanPrice: 101.2, ytmPct: 20.49 }, previousReliableTrade: { date: "2026-09-29", cleanPrice: 99, ytmPct: 26.5 } },
        latestObservationNumberOfTrades: 1,
        latestObservationVolumeGhs: 96000,
      }),
    ]);
    expect(item.kind).toBe("YIELD_MOVE");
    expect(item.headline).toContain(formatIsoDate("2026-09-30"));
    expect(item.headline).toContain(formatIsoDate("2026-09-29"));
    expect(item.headline).toContain("-601 bps");
    expect(item.detail).toContain("1 trade, GHS 96,000");
    expect(item.href).toBe("/fixed-income/GOG1");
  });

  it("does not call a move below the segment threshold a move (sovereign 500 bps, corporate 200 bps)", () => {
    expect(MATERIAL_YIELD_MOVE_BPS).toEqual({ SOVEREIGN: 500, CORPORATE: 200 });
    // 150 bps government move: noise, not reported. A 150 bps corporate move is below 200 too, and a corporate trade is reported as a plain new trade instead.
    const noisy = gov({ latestObservationDate: "2026-09-30", analytics: { ytmPct: 21 }, tradeHistory: { latestReliableTrade: { date: "2026-09-30", cleanPrice: 1, ytmPct: 21 }, previousReliableTrade: { date: "2026-09-29", cleanPrice: 1, ytmPct: 19.5 } } });
    expect(changes([noisy])).toEqual([]);
  });

  it("never compares trades more than 31 days apart — that is a different market, reported as a trade after a gap", () => {
    const [item] = changes([
      gov({ latestObservationDate: "2026-09-28", analytics: { ytmPct: 28.01 }, tradeHistory: { latestReliableTrade: { date: "2026-09-28", cleanPrice: 74.9, ytmPct: 28.01 }, previousReliableTrade: { date: "2026-08-11", cleanPrice: 124.5, ytmPct: 14.64 } } }),
    ]);
    expect(item.kind).toBe("TRADE_AFTER_GAP");
    expect(item.headline).toContain("first reliable trade since 11 Aug 2026 (48 days)");
    expect(item.headline).not.toMatch(/bps/);
  });

  it("reports a first-ever reliable trade without inventing a prior value", () => {
    const [item] = changes([gov({ tradeHistory: { previousReliableTrade: null, tradeDays: 1 } })]);
    expect(item.kind).toBe("TRADE_AFTER_GAP");
    expect(item.headline).toContain("first reliable trade in our history");
  });

  it("reports a new corporate trade with its change versus the previous trade when one exists", () => {
    const [item] = changes([sec()]);
    expect(item.kind).toBe("NEW_CORPORATE_TRADE");
    expect(item.headline).toContain("1 Oct 2026");
    expect(item.headline).toContain(`+10 bps versus ${formatIsoDate("2026-09-30")}`);
  });

  it("produces nothing from observations outside the recency window, withheld ones aside", () => {
    const old = sec({ latestObservationDate: "2026-05-07", observationFreshness: "STALE", observationAgeDays: 150, tradeHistory: { latestReliableTrade: { date: "2026-05-07", cleanPrice: 99, ytmPct: 23 }, previousReliableTrade: null } });
    expect(changes([old])).toEqual([]);
  });

  it("surfaces a withheld recent observation as a data-quality item first", () => {
    const flagged = sec({
      instrumentCode: "CORP2",
      analyticsEligible: false,
      analytics: { quality: { status: "REVIEW", issues: [{ code: "DUPLICATED_VOLUME", severity: "REVIEW", label: "Duplicated report volume", detail: "x" }] } },
    });
    const items = changes([sec(), flagged]);
    expect(items[0]).toMatchObject({ kind: "DATA_QUALITY", priority: 1 });
    expect(items[0].headline).toContain("withheld from analytics");
    expect(items[0].detail).toContain("Duplicated report volume");
  });

  it("aggregates securities that just became stale (10–17 days since the last reliable trade)", () => {
    const justStale = (code: string, date: string) => gov({ instrumentCode: code, latestObservationDate: date, observationFreshness: "STALE", observationAgeDays: 14, tradeHistory: { latestReliableTrade: { date, cleanPrice: 1, ytmPct: 20 }, previousReliableTrade: null } });
    const items = changes([justStale("A", "2026-09-20"), justStale("B", "2026-09-22")]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("BECAME_STALE");
    expect(items[0].headline).toContain("2 bonds became stale");
  });

  it("T-bills: states honestly that the latest auction is old rather than inventing a recent change", () => {
    const bills: BillAuctionSummary[] = [
      { code: "91", label: "91-Day", latest: { date: "2026-08-24", ratePct: 5.0795 }, previous: { date: "2026-08-17", ratePct: 5.4681 } },
      { code: "364", label: "364-Day", latest: { date: "2026-08-24", ratePct: 11.5929 }, previous: { date: "2026-08-17", ratePct: 12.5 } },
    ];
    const [item] = changes([], bills);
    expect(item.kind).toBe("TBILL_STALE");
    expect(item.tone).toBe("caution");
    expect(item.headline).toContain("since 24 Aug 2026 (41 days)");
    expect(item.detail).toContain("-91 bps");
  });

  it("T-bills: a material move in a RECENT auction is reported", () => {
    const bills: BillAuctionSummary[] = [{ code: "364", label: "364-Day", latest: { date: "2026-09-28", ratePct: 11.5 }, previous: { date: "2026-09-21", ratePct: 12.5 } }];
    expect(changes([], bills)[0]).toMatchObject({ kind: "TBILL_AUCTION", eventDate: "2026-09-28" });
    // 20 bps is inside normal weekly noise
    expect(changes([], [{ code: "364", label: "364-Day", latest: { date: "2026-09-28", ratePct: 12.3 }, previous: { date: "2026-09-21", ratePct: 12.5 } }])).toEqual([]);
  });

  it("returns at most five items, each carrying the date of its change", () => {
    const many = Array.from({ length: 12 }, (_, i) => sec({ instrumentCode: `C${i}`, issuerName: `Issuer ${i}` }));
    const items = changes(many);
    expect(items.length).toBeLessThanOrEqual(5);
    for (const i of items) expect(i.eventDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("comparePeerYield / unusual observations (M7.4 §C)", () => {
  const p = (code: string, date: string, y: number, over: Partial<YieldCurvePoint> = {}): YieldCurvePoint => ({ tenorDays: 500, tenorLabel: "1Y", yieldPct: y, instrumentLabel: code, instrumentCode: code, isGovernmentBond: true, observationDate: date, observationKind: "SECONDARY_MARKET", ...over });

  // GoG 19.75% Mar-32, 11 Aug 2026: 58.68% against government bonds trading around 20%.
  const pool = [p("A", "2026-08-10", 20.1), p("B", "2026-08-11", 19.5), p("C", "2026-08-13", 22.4), p("D", "2026-08-14", 21), p("MAR32", "2026-08-11", 58.68)];

  it("compares with the MEDIAN of other government trades inside ±7 days, excluding itself", () => {
    const d = comparePeerYield("MAR32", "2026-08-11", 58.68, pool)!;
    expect(d.peerCount).toBe(4);
    expect(d.medianPct).toBeCloseTo(20.55, 2);
    expect(d.gapBps).toBe(3813);
    expect(isUnusualVsPeers(d)).toBe(true);
  });

  it("is not unusual when the gap is ordinary thin-market noise", () => {
    expect(isUnusualVsPeers(comparePeerYield("X", "2026-08-11", 24, pool))).toBe(false);
  });

  it("returns null — no invented median — when fewer than three peers traded", () => {
    expect(comparePeerYield("MAR32", "2026-08-11", 58.68, pool.slice(0, 2))).toBeNull();
  });

  it("ignores T-bill auctions, primary points and trades outside the window", () => {
    const noisy = [...pool.slice(0, 2), p("TB", "2026-08-11", 5, { isGovernmentBond: false }), p("PRI", "2026-08-11", 5, { observationKind: "AUCTION_PRIMARY" }), p("FAR", "2026-06-01", 5)];
    expect(comparePeerYield("X", "2026-08-11", 30, noisy)).toBeNull();
  });

  it("flags the unusual government yield for investigation but never removes it", () => {
    const s = gov({ instrumentCode: "MAR32", latestObservationDate: "2026-08-11", observationFreshness: "STALE", observationAgeDays: 54, analytics: { ytmPct: 58.68 } });
    const reasons = investigationReasons(s, pool, VALUATION);
    expect(reasons.join(" ")).toContain("3,813 bps above the median");
    expect(s.analyticsEligible).toBe(true);
  });
});

describe("buildAnalystQueue — what deserves attention, without recommendations (M7.4 §E)", () => {
  const bench: BenchmarkSelection = {
    benchmark: { tenorDays: 650, tenorLabel: "2Y", yieldPct: 21.44, instrumentLabel: "GoG bond", instrumentCode: null, isGovernmentBond: true, observationDate: "2026-08-31", observationKind: "SECONDARY_MARKET" },
    tenorGapDays: 47,
    isWideGap: false,
    isSecondaryBenchmark: true,
    observationGapDays: 31,
  };
  const queue = buildAnalystQueue(
    [
      sec({ instrumentCode: "NEG", analytics: { ytmPct: 11.22 }, benchmark: bench, spreadBps: -1022 }),
      gov({ instrumentCode: "MAT", lifecycle: "MATURING_SOON", maturityDate: "2026-11-02", analytics: { tenorDays: 29, ytmPct: 6.29 } }),
      sec({ instrumentCode: "OLD", issuerName: "Old Issuer Plc", latestObservationDate: "2026-05-07", observationFreshness: "STALE", observationAgeDays: 150 }),
      sec({ instrumentCode: "TERMS", issuerName: "Terms Issuer Plc", termsIssues: [{ code: "MATURITY_CONFLICT", severity: "REVIEW", label: "Maturity conflict", detail: "x" }] }),
      sec({ instrumentCode: "GONE", lifecycle: "MATURED" }),
    ],
    [],
    VALUATION,
  );
  const codes = (g: { entries: { instrumentCode: string }[] }) => g.entries.map((e) => e.instrumentCode);

  it("lists recent reliable trades as new market activity, with dates", () => {
    expect(codes(queue.newActivity)).toEqual(expect.arrayContaining(["NEG", "TERMS"]));
    expect(queue.newActivity.entries[0].facts[0]).toContain("1 Oct 2026");
    expect(codes(queue.newActivity)).not.toContain("OLD");
  });

  it("flags a negative observed spread, a terms conflict and a stale corporate observation — as facts", () => {
    const facts = Object.fromEntries(queue.needsInvestigation.entries.map((e) => [e.instrumentCode, e.facts.join(" ")]));
    expect(facts.NEG).toContain("1,022 bps below the date-matched GoG observation");
    expect(facts.TERMS).toContain("Maturity conflict");
    expect(facts.OLD).toContain("150 days old");
  });

  it("lists securities inside the maturity window under upcoming, soonest first", () => {
    expect(codes(queue.upcoming)).toEqual(["MAT"]);
    expect(queue.upcoming.entries[0].facts[0]).toContain("Matures 2 Nov 2026 (29 days)");
  });

  it("never lists matured securities and keeps the issuer workflow", () => {
    const all = [...codes(queue.newActivity), ...codes(queue.needsInvestigation), ...codes(queue.upcoming)];
    expect(all).not.toContain("GONE");
    expect(queue.issuers).toEqual(["Acme Plc", "Old Issuer Plc", "Terms Issuer Plc"]);
  });

  it("contains no recommendation vocabulary", () => {
    const text = JSON.stringify(queue).toLowerCase();
    for (const w of ["attractive", "cheap", "undervalued", "overvalued", "best bond", "opportunity", "buy ", "sell "]) expect(text).not.toContain(w);
  });
});

describe("buildDecisionSupport — facts, limits and questions, never advice (M7.4 §F)", () => {
  const label = benchmarkLabeller([]);
  const bench = (yieldPct = 21.44): BenchmarkSelection => ({
    benchmark: { tenorDays: 650, tenorLabel: "2Y", yieldPct, instrumentLabel: "GoG 7Y Jun-28", instrumentCode: null, isGovernmentBond: true, observationDate: "2026-08-31", observationKind: "SECONDARY_MARKET" },
    tenorGapDays: 47,
    isWideGap: false,
    isSecondaryBenchmark: true,
    observationGapDays: 31,
  });
  function support(s: AnalystSecurity, peer = null as ReturnType<typeof comparePeerYield>, siblings = 1) {
    return buildDecisionSupport({ security: { ...s, benchmarkContext: describeBenchmarkContext(s, label) }, peer, issuerSiblingCount: siblings });
  }

  const corp = sec({ analytics: { ytmPct: 11.22 }, benchmark: bench(), spreadBps: -1022 });
  const ds = support(corp);

  it("states the observed spread with BOTH yields and BOTH dates, and keeps the unusual negative spread visible", () => {
    const text = ds.standsOut.join(" ");
    expect(text).toContain("last observed yield was 11.22% (1 Oct 2026)");
    expect(text).toContain("21.44% for the date-matched nearest-tenor GoG observation");
    expect(text).toContain("31 Aug 2026");
    expect(text).toContain("-1022 bps");
    expect(text).toContain("below the government observation");
    expect(ds.relativeValue.type).toBe("OBSERVED_SPREAD");
  });

  it("notes a loose date match when the benchmark was observed more than half the window from the trade", () => {
    expect(ds.standsOut.join(" ")).toContain("benchmark was observed 31 days from this trade");
  });

  it("states the stale-trade age and the missing executable quote", () => {
    const stale = support(sec({ latestObservationDate: "2026-05-07", observationFreshness: "STALE", observationAgeDays: 150 }));
    expect(stale.standsOut.join(" ")).toContain("The latest reliable trade is 150 days old");
    expect(stale.limitations.join(" ")).toContain("No executable quote");
    expect(stale.questions).toContain("What price or yield is currently executable?");
  });

  it("says plainly when no reliable trade exists, and uses carried-price language", () => {
    const none = support(sec({ latestObservationDate: null, observationFreshness: "MISSING", analyticsEligible: false, noTradeRecordedSince: "2025-07-21", carriedPrice: { cleanPrice: 101.02, asOf: "2026-10-02" }, analytics: { ytmPct: null, cleanPrice: null, observationKind: null, quality: null } }));
    expect(none.standsOut[0]).toContain("No reliable secondary-market trade is available");
    expect(none.limitations.join(" ")).toContain("carried from an earlier, unknown date");
    expect(none.market.ytmPct).toBeNull();
  });

  it("raises the terms question only when terms conflict, and asks which terms are authoritative", () => {
    expect(ds.questions.join(" ")).not.toContain("authoritative");
    const conflict = support(sec({ termsIssues: [{ code: "MATURITY_CONFLICT", severity: "REVIEW", label: "Maturity conflict", detail: "x" }] }));
    expect(conflict.questions[0]).toContain("Which contractual terms are authoritative");
    expect(conflict.standsOut.join(" ")).toContain("conflict with the securities master");
  });

  it("asks a credit/liquidity question for a positive spread and a different one for a negative spread", () => {
    expect(ds.questions.join(" ")).toContain("Why would the market price this issuer's yield below the government benchmark");
    const wide = support(sec({ analytics: { ytmPct: 30 }, benchmark: bench(), spreadBps: 856 }));
    expect(wide.questions.join(" ")).toContain("What credit or liquidity risk explains the yield difference");
  });

  it("asks the shorter-duration question only when maturing soon", () => {
    expect(support(gov({ lifecycle: "MATURING_SOON", analytics: { tenorDays: 29 } })).questions).toContain("How does the remaining return compare with shorter-duration alternatives?");
    expect(ds.questions).not.toContain("How does the remaining return compare with shorter-duration alternatives?");
  });

  it("lists only limitations relevant to the security: corporate credit gaps are absent for a government bond", () => {
    expect(ds.limitations).toEqual(expect.arrayContaining(["No credit assessment is incorporated.", "No issuer fundamentals are incorporated."]));
    expect(support(gov()).limitations.join(" ")).not.toContain("credit assessment");
  });

  it("notes that the source publishes no yield for a price-solved corporate yield", () => {
    expect(ds.limitations.join(" ")).toContain("source publishes no yield");
  });

  it("flags an unusual government yield against its peers with the median", () => {
    const peer = { yieldPct: 58.68, medianPct: 20.55, gapBps: 3813, peerCount: 4, windowDays: 7 };
    const g = support(gov({ analytics: { ytmPct: 58.68 } }), peer);
    expect(g.standsOut.join(" ")).toContain("3,813 bps above the median (20.55%) of 4 other government bonds");
    expect(g.questions.join(" ")).toContain("odd-lot or off-market");
  });

  it("offers compare / test price / evidence / issuer actions, and no issuer action for a government bond", () => {
    expect(ds.actions.map((a) => a.id)).toEqual(["compare", "test-price", "evidence", "issuer"]);
    expect(ds.actions[0].href).toBe("/fixed-income/compare?codes=CORP1");
    expect(support(gov()).actions.map((a) => a.id)).toEqual(["compare", "test-price", "evidence"]);
  });

  it("caps questions and never uses recommendation language anywhere", () => {
    const loaded = support(
      sec({ lifecycle: "MATURING_SOON", latestObservationDate: "2026-05-07", observationFreshness: "STALE", observationAgeDays: 150, termsIssues: [{ code: "MATURITY_CONFLICT", severity: "REVIEW", label: "Maturity conflict", detail: "x" }], benchmark: bench(), spreadBps: 500 }),
    );
    expect(loaded.questions.length).toBeLessThanOrEqual(4);
    const text = JSON.stringify([ds, loaded]).toLowerCase();
    for (const w of ["attractive", "cheap", "expensive", "undervalued", "overvalued", "low risk", "safe", "should buy", "investors should", "opportunity"]) expect(text).not.toContain(w);
  });
});
