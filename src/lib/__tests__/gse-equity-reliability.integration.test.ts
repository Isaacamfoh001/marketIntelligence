// ---------------------------------------------------------------------------
// Data Reliability Sprint — GSE equity pipeline, real database.
//
// Isolation: owns the ZZGR* ticker namespace (cannot collide with a real GSE
// share code or another test file's ZZ prefix), tracks every IngestionRun it
// creates and deletes exactly those, and scopes every status read to its own
// tickers/runs — it never reads or writes real market data. Each test builds
// its own rows; nothing depends on test order.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { importGseSecurityPrices } from "../ingestion/gse-security-provider";
import { getEquitySourceStatus } from "../queries/equity-source";
import { classifySecurityTrade, describeEquityDataState } from "../equities/source-currency";
import { resolveEquityValuationInput, type EquityPriceRow } from "../portfolio";
import { addPosition, createPortfolio } from "../portfolio-service";
import { createScenario, upsertShock } from "../scenario-service";
import { getInstrumentContext, getPortfolio } from "../queries/portfolio";
import { getScenario, runScenarioForPortfolio } from "../queries/scenarios";

const db = getPrisma();
const TAG = "ZZGR";
const runIds: string[] = [];

const HEADER =
  "Daily Date,Share Code,Year High (GH¢),Year Low (GH¢),Previous Closing Price - VWAP (GH¢),Opening Price (GH¢),Last Transaction Price (GH¢),Closing Price - VWAP (GH¢),Price Change (GH¢),Closing Bid Price (GH¢),Closing Offer Price (GH¢),Total Shares Traded,Total Value Traded (GH¢)";
/** One GSE export row. `vol` > 0 = actual trade; 0 = carried previous close. */
const r = (date: string, ticker: string, prev: number, close: number, vol: number, value = vol * close) =>
  `${date},${ticker},50.00,1.00,${prev.toFixed(2)},${prev.toFixed(2)},${close.toFixed(2)},${close.toFixed(2)},${(close - prev).toFixed(2)},,,${vol},${value.toFixed(2)}`;
const file = (...rows: string[]) => Buffer.from([HEADER, ...rows].join("\n"), "utf-8");

async function imp(name: string, buf: Buffer, opts: { now?: Date } = {}) {
  const res = await importGseSecurityPrices(name, buf, "daily", { commit: true, triggeredBy: "test", ...opts });
  if (res.runId) runIds.push(res.runId);
  return res;
}
const rowsFor = (ticker: string) => db.securityPrice.findMany({ where: { security: { ticker } }, orderBy: { tradingDate: "asc" } });
const NOW = new Date("2026-10-05T09:00:00Z");

// Securities/companies are created lazily by the importer and removed ONLY in
// afterAll. Deleting them per test would let a concurrently running file's
// getInstrumentContext() (which loads every security, then its company) catch a
// company mid-delete. Tests that assert on a security's existence therefore use
// a ticker that is unique to that test (uniq), never a shared one.
let seq = 0;
const uniq = (stem: string) => `${TAG}${stem}${++seq}`;

async function wipePerTest() {
  await db.portfolio.deleteMany({ where: { name: { startsWith: TAG } } }); // cascades positions/scenarios/shocks
  await db.securityPrice.deleteMany({ where: { security: { ticker: { startsWith: TAG } } } });
}

afterEach(wipePerTest);

afterAll(async () => {
  await wipePerTest();
  await db.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
  await db.security.deleteMany({ where: { ticker: { startsWith: TAG } } });
  await db.company.deleteMany({ where: { ticker: { startsWith: TAG } } });
});

describe("successful ingestion + provenance + timestamps", () => {
  it("stores report date, volume, prices and full provenance; records how the file was acquired", async () => {
    const before = Date.now();
    const res = await imp("official-export.csv", file(r("02/09/2026", "ZZGRA", 10, 10.5, 1000), r("02/09/2026", "ZZGRB", 4, 4, 0)));
    expect(res.status).toBe("SUCCESS");
    expect(res.inserted).toBe(2);

    const [a] = await rowsFor("ZZGRA");
    expect(a.tradingDate.toISOString().slice(0, 10)).toBe("2026-09-02");
    expect(Number(a.closeVwap)).toBe(10.5);
    expect(Number(a.volume)).toBe(1000);
    expect(a.retrievedAt.getTime()).toBeGreaterThanOrEqual(before - 1000); // ingestion timestamp
    expect(a.ingestionRunId).toBe(res.runId);

    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: res.runId! }, include: { dataSource: true } });
    expect(run.artifactName).toBe("official-export.csv");
    expect(run.acquisitionMethod).toBe("MANUAL_FILE_IMPORT");
    expect(run.dataSource.provider).toBe("Ghana Stock Exchange");
    expect(run.dataSource.url).toBe("https://gse.com.gh/trading-and-data/");
    expect(a.sourceId).toBe(run.dataSourceId);
    expect(run.recordsRead).toBe(2);
    expect(run.recordsAccepted).toBe(2);
    expect(run.recordsRejected).toBe(0);
  });
});

describe("idempotency", () => {
  it("re-importing the same file changes nothing — rows AND their original provenance are untouched", async () => {
    const buf = file(r("02/09/2026", "ZZGRA", 10, 10.5, 1000), r("03/09/2026", "ZZGRA", 10.5, 10.5, 0));
    const first = await imp("a.csv", buf);
    const rowsBefore = await rowsFor("ZZGRA");
    const second = await imp("a-again.csv", buf);

    expect(second.status).toBe("SUCCESS");
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(2);
    const rowsAfter = await rowsFor("ZZGRA");
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.map((x) => x.id)).toEqual(rowsBefore.map((x) => x.id));
    expect(rowsAfter.every((x) => x.ingestionRunId === first.runId)).toBe(true); // provenance not rewritten
    expect(rowsAfter.map((x) => x.updatedAt.getTime())).toEqual(rowsBefore.map((x) => x.updatedAt.getTime()));
  });

  it("a genuine republished correction IS applied and re-attributed to the new run", async () => {
    await imp("a.csv", file(r("02/09/2026", "ZZGRA", 10, 10.5, 1000)));
    const fix = await imp("a-corrected.csv", file(r("02/09/2026", "ZZGRA", 10, 10.7, 1000)));
    expect(fix.updated).toBe(1);
    const rows = await rowsFor("ZZGRA");
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].closeVwap)).toBe(10.7);
    expect(rows[0].ingestionRunId).toBe(fix.runId);
  });
});

describe("trade vs carried semantics", () => {
  it("stores a carried row (volume 0) as the source stated it — no invented volume, no new 'trade'", async () => {
    await imp("c.csv", file(r("02/09/2026", "ZZGRA", 10, 10.5, 1000), r("03/09/2026", "ZZGRA", 10.5, 10.5, 0)));
    const rows = await rowsFor("ZZGRA");
    expect(rows.map((x) => Number(x.volume))).toEqual([1000, 0]);
    expect(Number(rows[1].closeVwap)).toBe(Number(rows[1].previousCloseVwap));
  });

  it("security with no trade for several consecutive reports: last trade date stays at the real trade", async () => {
    await imp("d.csv", file(r("01/09/2026", "ZZGRA", 5, 5.2, 300), r("02/09/2026", "ZZGRA", 5.2, 5.2, 0), r("03/09/2026", "ZZGRA", 5.2, 5.2, 0), r("04/09/2026", "ZZGRA", 5.2, 5.2, 0)));
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA"], runIds } });
    expect(status.currency.latestReportDate).toBe("2026-09-04");
    expect(status.latestActualTradeDate).toBe("2026-09-01"); // not 4 Sep
    expect(status.coverage).toMatchObject({ reportDate: "2026-09-04", securitiesInReport: 1, withActualTrade: 0, carriedNoTrade: 1 });
  });

  it("newer report but older security trade: coverage counts it as carried, trade date is the older one", async () => {
    await imp("e.csv", file(
      r("01/09/2026", "ZZGRA", 5, 5.5, 100), r("01/09/2026", "ZZGRB", 8, 8.2, 50),
      r("02/09/2026", "ZZGRA", 5.5, 5.6, 10), r("02/09/2026", "ZZGRB", 8.2, 8.2, 0),
    ));
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA", "ZZGRB"], runIds } });
    expect(status.coverage).toMatchObject({ reportDate: "2026-09-02", securitiesInReport: 2, withActualTrade: 1, carriedNoTrade: 1 });
    const lastTrade = async (t: string) => (await rowsFor(t)).filter((x) => Number(x.volume) > 0).at(-1)!.tradingDate.toISOString().slice(0, 10);
    expect(await lastTrade("ZZGRA")).toBe("2026-09-02");
    expect(await lastTrade("ZZGRB")).toBe("2026-09-01");
  });
});

describe("row- and file-level failure behaviour", () => {
  it("partial: good rows import, the malformed row is rejected AND recorded on the run", async () => {
    const res = await imp("p.csv", file(r("02/09/2026", "ZZGRA", 10, 10.5, 1000), "02/09/2026,ZZGRB,50,1,4,4,4,not-a-number,0,,,0,0", r("02/09/2026", "ZZGRC", 3, 3, 0)));
    expect(res.status).toBe("SUCCESS");
    expect(res.recordsAccepted).toBe(2);
    expect(res.recordsRejected).toBe(1);
    expect(res.errors[0].rowNumber).toBe(3);
    expect(await rowsFor("ZZGRB")).toHaveLength(0);
    expect(await rowsFor("ZZGRA")).toHaveLength(1);
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: res.runId! } });
    expect(run.recordsRejected).toBe(1);
    expect(run.errorMessage).toContain("row 3");
  });

  it("total: a file where nothing validates FAILS the run and leaves earlier data intact", async () => {
    const good = await imp("good.csv", file(r("02/09/2026", "ZZGRA", 10, 10.5, 1000)));
    const X = uniq("X");
    const bad = await imp("bad.csv", Buffer.from(`${HEADER}\n02/09/2026,${X},,,,,,oops,,,,,\n`));
    expect(bad.status).toBe("FAILED");
    expect(bad.persisted).toBe(0);
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: bad.runId! } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toContain("No usable rows");
    const rows = await rowsFor("ZZGRA");
    expect(rows).toHaveLength(1);
    expect(rows[0].ingestionRunId).toBe(good.runId);
    expect(await db.security.findUnique({ where: { ticker: X } })).toBeNull();
  });

  it("a wrong file type fails the run without touching data", async () => {
    const res = await imp("notes.pdf", Buffer.from("not a spreadsheet"));
    expect(res.status).toBe("FAILED");
    expect((await db.ingestionRun.findUniqueOrThrow({ where: { id: res.runId! } })).status).toBe("FAILED");
  });

  it("database failure mid-file rolls the WHOLE file back (no partial state, no orphan security)", async () => {
    await imp("seed.csv", file(r("01/09/2026", "ZZGRA", 10, 10.5, 1000)));
    // closeVwap beyond Decimal(18,4) passes the parser but is rejected by PostgreSQL.
    const P = uniq("P"), N = uniq("N");
    const poison = `02/09/2026,${P},50,1,1,1,1,99999999999999999999,0,,,5,5`;
    const res = await imp("poison.csv", file(r("02/09/2026", "ZZGRA", 10.5, 11, 10), poison, r("02/09/2026", N, 2, 2, 5)));
    expect(res.status).toBe("FAILED");
    const rows = await rowsFor("ZZGRA");
    expect(rows).toHaveLength(1); // the 2 Sep row from the failed file was rolled back
    expect(rows[0].tradingDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(await db.security.findUnique({ where: { ticker: N } })).toBeNull();
    expect(await db.security.findUnique({ where: { ticker: P } })).toBeNull();
  });

  it("rejects a future-dated report row (clock injected)", async () => {
    const res = await imp("f.csv", file(r("02/09/2026", "ZZGRA", 1, 1, 1), r("20/12/2026", "ZZGRA", 1, 1, 1)), { now: NOW });
    expect(res.recordsRejected).toBe(1);
    expect(await rowsFor("ZZGRA")).toHaveLength(1);
  });
});

describe("security identity", () => {
  it("an unknown ticker creates exactly one Security keyed by the GSE share code and is reported for review", async () => {
    const N = uniq("N");
    const res = await imp("u.csv", file(r("02/09/2026", N, 2, 2, 5), r("03/09/2026", N, 2, 2.1, 7)));
    expect(res.newSecurities).toEqual([N]);
    expect(await db.security.count({ where: { ticker: N } })).toBe(1);
    const again = await imp("u2.csv", file(r("04/09/2026", N, 2.1, 2.1, 0)));
    expect(again.newSecurities).toEqual([]);
    expect(await db.security.count({ where: { ticker: N } })).toBe(1);
  });

  it("asterisk-decorated codes map to the same Security", async () => {
    const A = uniq("S");
    await imp("s.csv", file(r("02/09/2026", `**${A}**`, 2, 2, 5), r("03/09/2026", A, 2, 2, 0)));
    expect(await db.security.count({ where: { ticker: { startsWith: A } } })).toBe(1);
    expect(await rowsFor(A)).toHaveLength(2);
  });

  it("a duplicate source row is rejected, not double-counted", async () => {
    const res = await imp("dup.csv", file(r("02/09/2026", "ZZGRA", 2, 2, 5), r("02/09/2026", "ZZGRA", 2, 2, 5)));
    expect(res.recordsRejected).toBe(1);
    expect(await rowsFor("ZZGRA")).toHaveLength(1);
  });
});

describe("source freshness vs security freshness (two different questions)", () => {
  it("SOURCE CURRENT + stale security: pipeline healthy, this stock simply has not traded", async () => {
    await imp("cur.csv", file(
      r("15/09/2026", "ZZGRA", 5, 5.2, 300),
      r("02/10/2026", "ZZGRA", 5.2, 5.2, 0), r("02/10/2026", "ZZGRB", 9, 9.1, 40),
    ));
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA", "ZZGRB"], runIds } });
    expect(status.currency.state).toBe("CURRENT");
    const lastTradeA = "2026-09-15";
    const a = describeEquityDataState(status.currency, lastTradeA, NOW);
    expect(a.code).toBe("SOURCE_CURRENT_STALE_TRADE");
    expect(classifySecurityTrade(lastTradeA, NOW).ageDays).toBe(20);
    expect(describeEquityDataState(status.currency, "2026-10-02", NOW).code).toBe("SOURCE_CURRENT_RECENT_TRADE");
  });

  it("SOURCE STALE: the same recent-looking trade is NOT presented as current", async () => {
    await imp("old.csv", file(r("24/08/2026", "ZZGRA", 5, 5.2, 300)));
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA"], runIds } });
    expect(status.currency.state).toBe("STALE");
    expect(status.currency.weekdaysBehind).toBe(30);
    expect(describeEquityDataState(status.currency, "2026-08-24", NOW).code).toBe("SOURCE_STALE");
  });

  it("pipeline state is per-source: an empty scope is MISSING, not 'current'", async () => {
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGR_NONE"], runIds: [] } });
    expect(status.currency.state).toBe("MISSING");
    expect(status.coverage).toBeNull();
    expect(status.lastRun).toBeNull();
  });

  it("flags active securities that vanish from the newest report (without deactivating them)", async () => {
    await imp("v.csv", file(r("01/10/2026", "ZZGRA", 5, 5, 1), r("01/10/2026", "ZZGRB", 5, 5, 1), r("02/10/2026", "ZZGRA", 5, 5, 0)));
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA", "ZZGRB"], runIds } });
    expect(status.absentFromLatestReport).toEqual([{ ticker: "ZZGRB", lastReportDate: "2026-10-01", dormant: false }]);
    expect((await db.security.findUniqueOrThrow({ where: { ticker: "ZZGRB" } })).active).toBe(true);
  });

  it("a security gone for over 30 days is 'dormant', not a fresh drop", async () => {
    await imp("dm.csv", file(r("01/08/2026", "ZZGRB", 5, 5, 1), r("02/10/2026", "ZZGRA", 5, 5, 0)));
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA", "ZZGRB"], runIds } });
    expect(status.absentFromLatestReport).toEqual([{ ticker: "ZZGRB", lastReportDate: "2026-08-01", dormant: true }]);
  });

  it("a failed refresh after a success is surfaced while the previous data remains", async () => {
    await imp("ok.csv", file(r("02/10/2026", "ZZGRA", 5, 5, 1)));
    await imp("broken.csv", Buffer.from(`${HEADER}\n`)); // no rows → FAILED
    const status = await getEquitySourceStatus({ now: NOW, scope: { tickers: ["ZZGRA"], runIds } });
    expect(status.currency.lastRefreshFailed).toBe(true);
    expect(status.currency.latestReportDate).toBe("2026-10-02"); // data intact, not zeroed
    expect(status.lastRun?.status).toBe("FAILED");
    expect(status.lastSuccessfulRun?.status).toBe("SUCCESS");
  });
});

describe("M8.1 / Scenario Studio consume new evidence unchanged", () => {
  async function priceRows(ticker: string): Promise<EquityPriceRow[]> {
    return (await rowsFor(ticker)).map((x) => ({ tradingDate: x.tradingDate.toISOString().slice(0, 10), closeVwap: Number(x.closeVwap), volume: x.volume === null ? null : Number(x.volume), valueTradedGhs: x.valueTradedGhs === null ? null : Number(x.valueTradedGhs) }));
  }

  it("M8.1 never uses a carried price as a new trade, and moves to a newer actual trade when one arrives", async () => {
    await imp("m1.csv", file(r("01/09/2026", "ZZGRA", 10, 10, 100), r("02/09/2026", "ZZGRA", 10, 10, 0), r("03/09/2026", "ZZGRA", 10, 10, 0)));
    const v1 = resolveEquityValuationInput({ currency: "GHS", active: true, prices: await priceRows("ZZGRA") }, new Date("2026-09-04T00:00:00Z"));
    expect(v1).toMatchObject({ available: true, priceDate: "2026-09-01", latestReportDate: "2026-09-03", skippedNoTradeRows: 2, priceGhs: 10 });

    await imp("m2.csv", file(r("04/09/2026", "ZZGRA", 10, 11.5, 40), r("07/09/2026", "ZZGRA", 11.5, 11.5, 0)));
    const v2 = resolveEquityValuationInput({ currency: "GHS", active: true, prices: await priceRows("ZZGRA") }, new Date("2026-09-08T00:00:00Z"));
    expect(v2).toMatchObject({ available: true, priceDate: "2026-09-04", priceGhs: 11.5, latestReportDate: "2026-09-07", skippedNoTradeRows: 1 });
  });

  it("a security that only ever printed carried rows stays unvalued (no weakening of M8.1)", async () => {
    await imp("m3.csv", file(r("01/09/2026", "ZZGRC", 3, 3, 0), r("02/09/2026", "ZZGRC", 3, 3, 0)));
    const v = resolveEquityValuationInput({ currency: "GHS", active: true, prices: await priceRows("ZZGRC") }, new Date("2026-09-08T00:00:00Z"));
    expect(v).toMatchObject({ available: false, code: "NO_TRADE" });
  });

  it("portfolio reference value and scenario baseline follow the newly ingested trade (engine untouched)", async () => {
    await imp("pf1.csv", file(r("01/09/2026", "ZZGRM", 10, 10, 100), r("02/09/2026", "ZZGRM", 10, 10, 0)));
    const ctx0 = await getInstrumentContext();
    const eq = ctx0.equities.find((e) => e.ticker === "ZZGRM")!;
    const pf = await createPortfolio({ name: `${TAG} pf ${Math.random().toString(36).slice(2, 7)}` });
    if (!pf.ok) throw new Error(pf.error);
    const pos = await addPosition({ portfolioId: pf.id, assetClass: "EQUITY", instrumentId: eq.id, shares: 1000 });
    if (!pos.ok) throw new Error(pos.error);
    const sc = await createScenario({ portfolioId: pf.id, name: `${TAG} sc` });
    if (!sc.ok) throw new Error(sc.error);
    const shock = await upsertShock({ scenarioId: sc.id, target: { kind: "ASSET_CLASS", assetClass: "EQUITY" }, value: -10 });
    if (!shock.ok) throw new Error(shock.error);

    const run = async () => {
      const ctx = await getInstrumentContext();
      const portfolio = (await getPortfolio(pf.id, ctx))!;
      const scenario = (await getScenario(sc.id, ctx))!;
      const result = runScenarioForPortfolio(portfolio, scenario);
      if (!result.ok) throw new Error("scenario not ok");
      return { portfolio, result };
    };

    const before = await run();
    expect(before.portfolio.summary.referenceValueGhs).toBe(10_000); // 1,000 sh × GHS 10.00 (the 1 Sep trade, not the carried 2 Sep print)
    expect(before.result.portfolio.referenceBasisGhs).toBe(10_000);
    expect(before.result.portfolio.scenarioValueGhs).toBe(9_000);

    await imp("pf2.csv", file(r("03/09/2026", "ZZGRM", 10, 12, 50), r("04/09/2026", "ZZGRM", 12, 12, 0)));
    const after = await run();
    expect(after.portfolio.summary.referenceValueGhs).toBe(12_000);
    expect(after.result.portfolio.referenceBasisGhs).toBe(12_000);
    expect(after.result.portfolio.scenarioValueGhs).toBeCloseTo(10_800, 6);
    const row = after.result.portfolio.byAssetClass.find((c) => c.assetClass === "EQUITY")!;
    expect(row.referenceValueGhs).toBe(12_000);
  });
});
