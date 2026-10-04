// ---------------------------------------------------------------------------
// Integration tests for the Fixed Income query layer (M7). Real database —
// seeds synthetic securities/observations through the actual import
// providers (never hand-written Prisma creates, so this exercises the same
// path production imports use), then exercises the universe/detail/yield-
// curve/comparables queries against real Treasury data already in the dev
// database.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma } from "../../prisma";
import { importFixedIncomeSecurities } from "../../ingestion/fixed-income-securities-provider";
import { importFixedIncomeObservations } from "../../ingestion/fixed-income-observations-provider";
import { getFixedIncomeUniverse, getFixedIncomeSecurityByCode, getSovereignYieldCurve, getComparableUniverse, getFixedIncomeWorkspace } from "../fixed-income";

const db = getPrisma();
const CORP_CODE = "ZZQFI-CORP-1";
const GOV_CODE = "ZZQFI-GOV-1";
const TEST_CODES = [CORP_CODE, GOV_CODE];
const TEST_ISSUER = "ZZQFI Test Issuer PLC";
const GOV_ISSUER = "ZZQFI Government";
const createdRunIds: string[] = [];
const SETTLEMENT = new Date("2026-06-15T00:00:00.000Z");

function securitiesCsv(rows: string[]): Buffer {
  const header =
    "Instrument Code,Instrument Name,Issuer Name,Ticker,Instrument Type,Currency,Issue Date,Maturity Date,Coupon Type,Coupon Rate,Coupon Frequency,Face Value,Status";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

function observationsCsv(rows: string[]): Buffer {
  const header = "Instrument Code,Observation Date,Clean Price,Yield,Volume Traded,Observation Kind";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

beforeAll(async () => {
  const securities = await importFixedIncomeSecurities(
    "seed.csv",
    securitiesCsv([
      `${CORP_CODE},ZZQFI Corporate Bond,${TEST_ISSUER},,CORPORATE_BOND,GHS,2024-06-15,2029-06-15,FIXED,24,SEMI_ANNUAL,100,ACTIVE`,
      `${GOV_CODE},ZZQFI Government Bond,${GOV_ISSUER},,GOVERNMENT_BOND,GHS,2024-06-15,2027-06-15,FIXED,20,SEMI_ANNUAL,100,ACTIVE`,
    ]),
    { commit: true },
  );
  if (securities.runId) createdRunIds.push(securities.runId);

  const observations = await importFixedIncomeObservations(
    "seed-obs.csv",
    observationsCsv([`${CORP_CODE},2026-06-01,92.5,,100000,SECONDARY_MARKET`, `${GOV_CODE},2026-06-01,98,,50000,SECONDARY_MARKET`]),
    { commit: true },
  );
  if (observations.runId) createdRunIds.push(observations.runId);
});

afterAll(async () => {
  const securities = await db.fixedIncomeSecurity.findMany({ where: { instrumentCode: { in: TEST_CODES } } });
  const securityIds = securities.map((s) => s.id);
  await db.fixedIncomeObservation.deleteMany({ where: { securityId: { in: securityIds } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { in: TEST_CODES } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.company.deleteMany({ where: { name: { in: [TEST_ISSUER, GOV_ISSUER] } } });
});

describe("getFixedIncomeUniverse", () => {
  it("includes the seeded securities with computed YTM above coupon (priced below par)", async () => {
    const universe = await getFixedIncomeUniverse(SETTLEMENT);
    const corp = universe.find((s) => s.instrumentCode === CORP_CODE);
    expect(corp).toBeDefined();
    expect(corp!.classification).toBe("CORPORATE");
    expect(corp!.analytics.ytmPct).not.toBeNull();
    expect(corp!.analytics.ytmPct!).toBeGreaterThan(24);
  });
});

describe("getFixedIncomeSecurityByCode", () => {
  it("returns full analytics for a single instrument", async () => {
    const security = await getFixedIncomeSecurityByCode(GOV_CODE, SETTLEMENT);
    expect(security).not.toBeNull();
    expect(security!.analytics.modifiedDurationYears).not.toBeNull();
  });

  it("returns null for an unknown instrument code", async () => {
    expect(await getFixedIncomeSecurityByCode("ZZQFI-NOPE", SETTLEMENT)).toBeNull();
  });
});

describe("getSovereignYieldCurve", () => {
  it("includes both real Treasury bill points and the seeded government bond", async () => {
    const curve = await getSovereignYieldCurve(SETTLEMENT);
    expect(curve.length).toBeGreaterThan(0);
    expect(curve.some((p) => !p.isGovernmentBond)).toBe(true); // at least one T-bill point from real data
    expect(curve.some((p) => p.instrumentCode === GOV_CODE)).toBe(true);
    // sorted ascending by tenor
    for (let i = 1; i < curve.length; i++) expect(curve[i].tenorDays).toBeGreaterThanOrEqual(curve[i - 1].tenorDays);
  });
});

describe("getComparableUniverse", () => {
  it("includes seeded bonds and real Treasury bills with a computed spread for the corporate bond", async () => {
    const universe = await getComparableUniverse(SETTLEMENT);
    const corp = universe.find((r) => r.instrumentCode === CORP_CODE);
    expect(corp).toBeDefined();
    expect(corp!.spreadBps).not.toBeNull();
    expect(universe.some((r) => r.instrumentType === "TREASURY_BILL")).toBe(true);
  });
});

describe("getFixedIncomeWorkspace (M7.3)", () => {
  it("derives lifecycle and observation freshness, and attaches a sovereign benchmark to corporates only", async () => {
    const workspace = await getFixedIncomeWorkspace(SETTLEMENT);
    expect(workspace.valuationDateIso).toBe("2026-06-15");
    const corp = workspace.securities.find((s) => s.instrumentCode === CORP_CODE)!;
    const gov = workspace.securities.find((s) => s.instrumentCode === GOV_CODE)!;
    expect(corp.lifecycle).toBe("ACTIVE");
    expect(corp.observationAgeDays).toBe(14); // observed 2026-06-01
    expect(corp.observationFreshness).toBe("STALE"); // GFIM is daily-cadence; 14 days old is stale, never shown as current
    expect(corp.latestObservationCleanPrice).toBe(92.5);
    expect(corp.terms.couponRatePct).toBe(24);
    expect(corp.benchmark).not.toBeNull();
    expect(corp.spreadBps).not.toBeNull();
    expect(gov.benchmark).toBeNull();
    expect(gov.spreadBps).toBeNull();
  });

  it("classifies a security as MATURED from its maturity date, even though the master status says ACTIVE", async () => {
    const workspace = await getFixedIncomeWorkspace(new Date("2027-06-15T00:00:00.000Z"));
    const gov = workspace.securities.find((s) => s.instrumentCode === GOV_CODE)!;
    expect(gov.status).toBe("ACTIVE");
    expect(gov.lifecycle).toBe("MATURED");
    expect(gov.latestObservationCleanPrice).toBe(98); // final known quote kept for research
  });

  it("carries freshness on every comparable row (weekly cadence for T-bills)", async () => {
    const workspace = await getFixedIncomeWorkspace(SETTLEMENT);
    expect(workspace.comparables.every((r) => ["CURRENT", "STALE", "MISSING"].includes(r.freshness))).toBe(true);
    expect(workspace.comparables.find((r) => r.instrumentCode === CORP_CODE)!.couponRatePct).toBe(24);
  });
});
