// ---------------------------------------------------------------------------
// Tests for the fresh-on-demand USD/GHS refresh guard (M8.2 Part A).
//
// The database is real (per project convention). External HTTP is mocked —
// these tests must not depend on bog.gov.gh being online. Every fixture
// clock and observation date lives in 2099 so this suite never collides
// with real historical BoG data already in this DB, and IngestionRun rows
// created along the way have their `startedAt` explicitly moved into the
// same synthetic timeline (its default is the DB's real wall-clock time,
// which a 2099 `now` would otherwise never see as "recent").
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/http", () => ({
  fetchBogText: vi.fn(),
  postBogForm: vi.fn(),
}));

import { fetchBogText } from "../ingestion/http";
import { ensureFreshUsdGhs, FX_REFRESH_COOLDOWN_MS } from "../ingestion/bog-fx-freshness";

const db = getPrisma();
const mockFetch = vi.mocked(fetchBogText);

const FX_DATA_SOURCE_NAME = "Bank of Ghana — Daily Interbank FX Rates";
const PAIR_CODE = "USDGHS";
const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");

function dailyHtml(dateLabel: string, mid: string): string {
  return `<html><body><table><tbody><tr><td>${dateLabel}</td><td>US Dollar</td><td>USDGHS</td><td>${mid}</td><td>${mid}</td><td>${mid}</td></tr></tbody></table></body></html>`;
}

function fmtBogDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const createdRunIds: string[] = [];

async function seedExchangeRate(observationDate: Date): Promise<void> {
  const dataSource = await db.dataSource.findUniqueOrThrow({ where: { name: FX_DATA_SOURCE_NAME } });
  const pair = await db.currencyPair.findUniqueOrThrow({ where: { code: PAIR_CODE } });
  const run = await db.ingestionRun.create({
    data: { dataSourceId: dataSource.id, status: "SUCCESS", triggeredBy: "test-seed", completedAt: observationDate },
  });
  createdRunIds.push(run.id);
  await db.exchangeRate.upsert({
    where: { currencyPairId_observationDate: { currencyPairId: pair.id, observationDate } },
    update: { midRate: "11.5", sourceId: dataSource.id, ingestionRunId: run.id },
    create: { currencyPairId: pair.id, observationDate, midRate: "11.5", sourceId: dataSource.id, ingestionRunId: run.id },
  });
}

/** Directly records "a refresh was attempted at `startedAt`" without going through ingestBogFxDaily. */
async function seedRecentRunAttempt(startedAt: Date): Promise<void> {
  const dataSource = await db.dataSource.findUniqueOrThrow({ where: { name: FX_DATA_SOURCE_NAME } });
  const run = await db.ingestionRun.create({
    data: { dataSourceId: dataSource.id, status: "SUCCESS", triggeredBy: "test-seed", startedAt, completedAt: startedAt },
  });
  createdRunIds.push(run.id);
}

async function latestObservationDate(): Promise<Date | null> {
  const pair = await db.currencyPair.findUnique({ where: { code: PAIR_CODE } });
  if (!pair) return null;
  const latest = await db.exchangeRate.findFirst({
    where: { currencyPairId: pair.id },
    orderBy: { observationDate: "desc" },
    select: { observationDate: true },
  });
  return latest?.observationDate ?? null;
}

async function cleanupSyntheticExchangeRates(): Promise<void> {
  await db.exchangeRate.deleteMany({ where: { observationDate: { gte: SYNTHETIC_FLOOR } } });
}

beforeAll(async () => {
  // Idempotent — mirrors bog-fx-provider.ts's own bootstrap so this suite
  // is self-contained even against an empty DB, and a no-op against a DB
  // where BoG FX ingestion already ran.
  await db.dataSource.upsert({
    where: { name: FX_DATA_SOURCE_NAME },
    update: {},
    create: {
      name: FX_DATA_SOURCE_NAME,
      provider: "Bank of Ghana",
      sourceType: "AUTOMATED",
      expectedFrequency: "DAILY",
      ingestionMethod: "HTML_FETCH",
      active: true,
    },
  });
  await db.currencyPair.upsert({
    where: { code: PAIR_CODE },
    update: {},
    create: { code: PAIR_CODE, baseCurrency: "USD", quoteCurrency: "GHS" },
  });
});

beforeEach(async () => {
  mockFetch.mockReset();
  await cleanupSyntheticExchangeRates();
});

afterAll(async () => {
  await cleanupSyntheticExchangeRates();
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ensureFreshUsdGhs", () => {
  it("does not call BoG when the latest observation is CURRENT", async () => {
    // A Tuesday — unambiguously a business day, no weekend edge case here.
    const now = new Date("2099-03-10T09:00:00.000Z");
    await seedExchangeRate(now);

    await ensureFreshUsdGhs(PAIR_CODE, now);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("triggers a bounded BoG refresh when the latest observation is stale, and the caller re-reads the new value", async () => {
    const now = new Date("2099-03-20T09:00:00.000Z");
    const stale = new Date("2099-03-10T00:00:00.000Z"); // 10 days stale
    await seedExchangeRate(stale);

    mockFetch.mockResolvedValueOnce(dailyHtml(fmtBogDate(now), "12.3456"));

    await ensureFreshUsdGhs(PAIR_CODE, now);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const latest = await latestObservationDate();
    expect(latest?.toISOString().slice(0, 10)).toBe(now.toISOString().slice(0, 10));
  });

  it("falls back to the last observation when the refresh fails, without throwing", async () => {
    const now = new Date("2099-04-15T09:00:00.000Z");
    const stale = new Date("2099-04-01T00:00:00.000Z");
    await seedExchangeRate(stale);

    mockFetch.mockRejectedValueOnce(new Error("simulated BoG outage"));

    await expect(ensureFreshUsdGhs(PAIR_CODE, now)).resolves.toBeUndefined();

    const latest = await latestObservationDate();
    expect(latest?.toISOString().slice(0, 10)).toBe(stale.toISOString().slice(0, 10));

    const dataSource = await db.dataSource.findUniqueOrThrow({ where: { name: FX_DATA_SOURCE_NAME } });
    const failedRun = await db.ingestionRun.findFirst({
      where: { dataSourceId: dataSource.id, status: "FAILED", errorMessage: { contains: "simulated BoG outage" } },
      orderBy: { startedAt: "desc" },
    });
    expect(failedRun).not.toBeNull();
    if (failedRun) createdRunIds.push(failedRun.id);
  });

  it("does not call BoG again when a refresh was already attempted within the cooldown window, even though still stale", async () => {
    const now = new Date("2099-05-20T09:00:00.000Z");
    const stale = new Date("2099-05-01T00:00:00.000Z");
    await seedExchangeRate(stale);
    await seedRecentRunAttempt(new Date(now.getTime() - FX_REFRESH_COOLDOWN_MS / 2));

    await ensureFreshUsdGhs(PAIR_CODE, now);

    expect(mockFetch).not.toHaveBeenCalled();
    const latest = await latestObservationDate();
    expect(latest?.toISOString().slice(0, 10)).toBe(stale.toISOString().slice(0, 10));
  });

  it("does call BoG once the cooldown window has elapsed", async () => {
    const now = new Date("2099-06-20T09:00:00.000Z");
    const stale = new Date("2099-06-01T00:00:00.000Z");
    await seedExchangeRate(stale);
    await seedRecentRunAttempt(new Date(now.getTime() - FX_REFRESH_COOLDOWN_MS - 60_000)); // just past cooldown

    mockFetch.mockResolvedValueOnce(dailyHtml(fmtBogDate(now), "12.0"));

    await ensureFreshUsdGhs(PAIR_CODE, now);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("only triggers one BoG call across concurrent stale requests", async () => {
    const now = new Date("2099-07-10T09:00:00.000Z");
    const stale = new Date("2099-07-01T00:00:00.000Z");
    await seedExchangeRate(stale);

    let resolveFetch!: (html: string) => void;
    mockFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    const call1 = ensureFreshUsdGhs(PAIR_CODE, now);
    const call2 = ensureFreshUsdGhs(PAIR_CODE, now);

    // Let both calls reach the refresh trigger (real DB round-trips) before
    // resolving the fetch — poll rather than a fixed sleep, since DB
    // latency is not bounded.
    while (mockFetch.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetch(dailyHtml(fmtBogDate(now), "12.5"));

    await Promise.all([call1, call2]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("treats a Friday observation as CURRENT when viewed the following Saturday (business-day aware)", async () => {
    const saturday = new Date("2099-08-01T09:00:00.000Z");
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
    expect(saturday.getUTCDay()).toBe(6);
    const friday = new Date(saturday);
    friday.setUTCDate(friday.getUTCDate() - 1);
    friday.setUTCHours(0, 0, 0, 0);
    await seedExchangeRate(friday);

    await ensureFreshUsdGhs(PAIR_CODE, saturday);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
