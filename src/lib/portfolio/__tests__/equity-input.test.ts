import { describe, expect, it } from "vitest";
import { EQUITY_RECENT_WINDOW_DAYS, resolveEquityValuationInput, type EquityPriceRow, type EquityValuationSource } from "..";

const VALUATION = new Date("2026-10-05T00:00:00.000Z");

const row = (tradingDate: string, closeVwap: number, volume: number | null, valueTradedGhs: number | null = null): EquityPriceRow => ({ tradingDate, closeVwap, volume, valueTradedGhs });
const src = (prices: EquityPriceRow[], over: Partial<EquityValuationSource> = {}): EquityValuationSource => ({ currency: "GHS", active: true, prices, ...over });

describe("resolveEquityValuationInput — verified actual-trade rule", () => {
  // Real pattern from the database (ALW, Jun 2026): GSE prints a row every day;
  // on no-trade days volume is 0 and closeVwap == previousCloseVwap (carried).
  const ALW = [row("2026-06-08", 0.1, 0), row("2026-06-09", 0.1, 0), row("2026-06-10", 0.1, 10272, 86901.12), row("2026-06-11", 0.1, 0), row("2026-06-12", 0.1, 0)];

  it("uses the newest row with volume > 0 and carries ITS date and age, not the later carried rows'", () => {
    const r = resolveEquityValuationInput(src(ALW), new Date("2026-06-12T00:00:00.000Z"));
    expect(r).toMatchObject({ available: true, priceGhs: 0.1, priceDate: "2026-06-10", ageDays: 2, volume: 10272, isActualTrade: true, latestReportDate: "2026-06-12", skippedNoTradeRows: 2 });
  });

  it("REGRESSION: a newer zero-volume row with a DIFFERENT price is never used (it would present a stale carried close as today's)", () => {
    const r = resolveEquityValuationInput(src([row("2026-09-30", 12.5, 4000), row("2026-10-02", 13.9, 0)]), VALUATION);
    expect(r).toMatchObject({ available: true, priceGhs: 12.5, priceDate: "2026-09-30", ageDays: 5, skippedNoTradeRows: 1 });
  });

  it("the latest row being a real trade is used directly with nothing skipped", () => {
    expect(resolveEquityValuationInput(src([row("2026-10-02", 31.2, 1500, 46800), row("2026-10-01", 31, 800)]), VALUATION)).toMatchObject({ priceGhs: 31.2, priceDate: "2026-10-02", skippedNoTradeRows: 0, valueTradedGhs: 46800 });
  });

  it("is independent of row order", () => {
    const rows = [row("2026-09-29", 10, 100), row("2026-10-01", 11, 200), row("2026-09-30", 10.5, 0)];
    expect(resolveEquityValuationInput(src(rows), VALUATION)).toMatchObject({ priceDate: "2026-10-01", priceGhs: 11 });
    expect(resolveEquityValuationInput(src([...rows].reverse()), VALUATION)).toMatchObject({ priceDate: "2026-10-01", priceGhs: 11 });
  });

  it("a null (unpublished) volume does not establish a trade and is skipped", () => {
    expect(resolveEquityValuationInput(src([row("2026-10-01", 9, null), row("2026-09-25", 8, 50)]), VALUATION)).toMatchObject({ priceDate: "2026-09-25", priceGhs: 8 });
  });

  it("a trade with volume but no published value traded is still a trade (GSE value column is unreliable)", () => {
    expect(resolveEquityValuationInput(src([row("2026-10-01", 2.25, 20, 0)]), VALUATION)).toMatchObject({ available: true, priceGhs: 2.25 });
  });

  it("never-traded security → unavailable NO_TRADE, citing the earliest row held; never a price", () => {
    const r = resolveEquityValuationInput(src([row("2026-08-24", 0.02, 0), row("2025-01-02", 0.02, 0)]), VALUATION);
    expect(r).toMatchObject({ available: false, code: "NO_TRADE" });
    expect((r as { reason: string }).reason).toContain("2025-01-02");
  });

  it("no rows at all → unavailable NO_PRICE", () => {
    expect(resolveEquityValuationInput(src([]), VALUATION)).toMatchObject({ available: false, code: "NO_PRICE" });
  });

  it("ignores rows dated after the valuation date and rows with a non-positive price", () => {
    expect(resolveEquityValuationInput(src([row("2026-10-09", 99, 10), row("2026-10-01", 0, 10), row("2026-09-28", 7, 10)]), VALUATION)).toMatchObject({ priceDate: "2026-09-28", priceGhs: 7 });
  });

  it("inactive and non-GHS securities are unavailable", () => {
    expect(resolveEquityValuationInput(src([row("2026-10-01", 5, 10)], { active: false }), VALUATION)).toMatchObject({ available: false, code: "INACTIVE" });
    expect(resolveEquityValuationInput(src([row("2026-10-01", 5, 10)], { currency: "USD" }), VALUATION)).toMatchObject({ available: false, code: "NOT_GHS" });
  });
});

describe("equity recency — 7 calendar days", () => {
  const at = (age: number) => new Date(VALUATION.getTime() - age * 86_400_000).toISOString().slice(0, 10);
  it("recent at exactly 7 days, stale at 8; age is always exposed", () => {
    expect(EQUITY_RECENT_WINDOW_DAYS).toBe(7);
    expect(resolveEquityValuationInput(src([row(at(7), 5, 10)]), VALUATION)).toMatchObject({ ageDays: 7, recency: "RECENT" });
    expect(resolveEquityValuationInput(src([row(at(8), 5, 10)]), VALUATION)).toMatchObject({ ageDays: 8, recency: "STALE" });
  });

  it("the newest available row is not called current merely for being newest — 42-day-old data is stale", () => {
    expect(resolveEquityValuationInput(src([row("2026-08-24", 30, 1000)]), VALUATION)).toMatchObject({ ageDays: 42, recency: "STALE" });
  });
});
