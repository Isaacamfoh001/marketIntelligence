// ---------------------------------------------------------------------------
// Integration tests for the Fixed Income Securities + Observations import
// pipelines (M7). Real database — synthetic instrument codes (ZZFI-...) and
// a synthetic issuer name can never collide with real data. Every
// IngestionRun/Company/Security created is tracked and deleted in afterAll,
// mirroring financials-ingestion.integration.test.ts.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "../prisma";
import { importFixedIncomeSecurities } from "../ingestion/fixed-income-securities-provider";
import { importFixedIncomeObservations } from "../ingestion/fixed-income-observations-provider";

const db = getPrisma();
const TEST_CODES = ["ZZFI-BND-1", "ZZFI-BND-2"];
const TEST_ISSUER = "ZZ Test Issuer PLC";
const createdRunIds: string[] = [];

async function trackedImport<T extends { runId: string | null }>(result: Promise<T>): Promise<T> {
  const resolved = await result;
  if (resolved.runId) createdRunIds.push(resolved.runId);
  return resolved;
}

function securitiesCsv(rows: string[]): Buffer {
  const header =
    "Instrument Code,Instrument Name,Issuer Name,Ticker,Instrument Type,Currency,Issue Date,Maturity Date,Coupon Type,Coupon Rate,Coupon Frequency,Face Value,Status";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

function observationsCsv(rows: string[]): Buffer {
  const header = "Instrument Code,Observation Date,Clean Price,Yield,Volume Traded,Observation Kind";
  return Buffer.from([header, ...rows].join("\n"), "utf-8");
}

afterAll(async () => {
  const securities = await db.fixedIncomeSecurity.findMany({ where: { instrumentCode: { in: TEST_CODES } } });
  const securityIds = securities.map((s) => s.id);
  await db.fixedIncomeObservation.deleteMany({ where: { securityId: { in: securityIds } } });
  await db.fixedIncomeSecurity.deleteMany({ where: { instrumentCode: { in: TEST_CODES } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await db.company.deleteMany({ where: { name: TEST_ISSUER } });
});

describe("importFixedIncomeSecurities — preview", () => {
  it("validates without creating a run or persisting anything", async () => {
    const buffer = securitiesCsv([`${TEST_CODES[0]},ZZ Test Bond 1,${TEST_ISSUER},,CORPORATE_BOND,GHS,2024-01-01,2028-01-01,FIXED,20,SEMI_ANNUAL,100,ACTIVE`]);
    const result = await importFixedIncomeSecurities("fi-securities.csv", buffer, { commit: false });

    expect(result.status).toBe("PREVIEW");
    expect(result.runId).toBeNull();
    expect(result.recordsAccepted).toBe(1);

    const stored = await db.fixedIncomeSecurity.findUnique({ where: { instrumentCode: TEST_CODES[0] } });
    expect(stored).toBeNull();
  });
});

describe("importFixedIncomeSecurities — commit", () => {
  it("persists a corporate bond, creating its issuer Company with full provenance", async () => {
    const buffer = securitiesCsv([`${TEST_CODES[0]},ZZ Test Bond 1,${TEST_ISSUER},,CORPORATE_BOND,GHS,2024-01-01,2028-01-01,FIXED,20,SEMI_ANNUAL,100,ACTIVE`]);
    const result = await trackedImport(importFixedIncomeSecurities("zz-bond.csv", buffer, { commit: true }));

    expect(result.status).toBe("SUCCESS");
    expect(result.inserted).toBe(1);

    const stored = await db.fixedIncomeSecurity.findUniqueOrThrow({
      where: { instrumentCode: TEST_CODES[0] },
      include: { company: true, source: true, ingestionRun: true },
    });
    expect(stored.classification).toBe("CORPORATE");
    expect(stored.company?.name).toBe(TEST_ISSUER);
    expect(stored.company?.ticker).toBeNull();
    expect(Number(stored.couponRatePct)).toBe(20);
    expect(stored.ingestionRun.artifactName).toBe("zz-bond.csv");
  });

  it("re-importing with a changed coupon rate reports a restatement and upserts in place (idempotent, no duplicate row)", async () => {
    const original = securitiesCsv([`${TEST_CODES[1]},ZZ Test Bond 2,${TEST_ISSUER},,GOVERNMENT_BOND,GHS,2024-01-01,2029-01-01,FIXED,19,ANNUAL,100,ACTIVE`]);
    await trackedImport(importFixedIncomeSecurities("zz-bond-2-v1.csv", original, { commit: true }));

    const revised = securitiesCsv([`${TEST_CODES[1]},ZZ Test Bond 2,${TEST_ISSUER},,GOVERNMENT_BOND,GHS,2024-01-01,2029-01-01,FIXED,19.5,ANNUAL,100,ACTIVE`]);
    const result = await trackedImport(importFixedIncomeSecurities("zz-bond-2-v2.csv", revised, { commit: true }));

    expect(result.updated).toBe(1);
    expect(result.restatements.some((r) => r.field === "couponRatePct")).toBe(true);

    const count = await db.fixedIncomeSecurity.count({ where: { instrumentCode: TEST_CODES[1] } });
    expect(count).toBe(1);
    const stored = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { instrumentCode: TEST_CODES[1] } });
    expect(Number(stored.couponRatePct)).toBe(19.5);
  });
});

describe("importFixedIncomeObservations", () => {
  it("rejects an observation for an instrument code with no matching security", async () => {
    const buffer = observationsCsv(["ZZ-UNKNOWN-CODE,2026-01-15,97.5,,,SECONDARY_MARKET"]);
    const result = await trackedImport(importFixedIncomeObservations("unknown.csv", buffer, { commit: true }));

    expect(result.unknownInstruments).toHaveLength(1);
    expect(result.unknownInstruments[0].instrumentCode).toBe("ZZ-UNKNOWN-CODE");

    const count = await db.fixedIncomeObservation.count();
    const anyForUnknown = await db.fixedIncomeObservation.findFirst({ where: { security: { instrumentCode: "ZZ-UNKNOWN-CODE" } } });
    expect(anyForUnknown).toBeNull();
    expect(count).toBeGreaterThanOrEqual(0); // sanity: query itself doesn't throw
  });

  it("persists an observation and is idempotent across a re-run with the same values", async () => {
    const buffer = observationsCsv([`${TEST_CODES[0]},2026-02-10,95.25,21.4,750000,SECONDARY_MARKET`]);
    const first = await trackedImport(importFixedIncomeObservations("obs-1.csv", buffer, { commit: true }));
    expect(first.inserted).toBe(1);

    const second = await trackedImport(importFixedIncomeObservations("obs-1-rerun.csv", buffer, { commit: true }));
    expect(second.updated).toBe(1);
    expect(second.inserted).toBe(0);

    const security = await db.fixedIncomeSecurity.findUniqueOrThrow({ where: { instrumentCode: TEST_CODES[0] } });
    const count = await db.fixedIncomeObservation.count({ where: { securityId: security.id } });
    expect(count).toBe(1);
  });
});
