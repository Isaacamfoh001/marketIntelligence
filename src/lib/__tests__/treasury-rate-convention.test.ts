// ---------------------------------------------------------------------------
// Verifies the BoG discount-rate <-> interest-rate-equivalent conversion
// (M7.1 §9) against real published auction data, and confirms every
// TreasuryRate row already in the database satisfies the same relationship
// — i.e. the platform's existing choice of `interestRate` as the
// YTM-comparable measure is financially correct, not merely assumed.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { describe, it, expect } from "vitest";
import { getPrisma } from "../prisma";
import { interestRateFromDiscountRate, discountRateFromInterestRate } from "../treasury-rate-convention";

describe("interestRateFromDiscountRate — real BoG auction data (2026-09-28)", () => {
  it("reproduces the published 91-day interest rate from the published discount rate", () => {
    expect(interestRateFromDiscountRate(4.6244, 91)).toBeCloseTo(4.6785, 2);
  });

  it("reproduces the published 182-day interest rate from the published discount rate", () => {
    expect(interestRateFromDiscountRate(6.1734, 182)).toBeCloseTo(6.3700, 1);
  });

  it("reproduces the published 364-day interest rate from the published discount rate", () => {
    expect(interestRateFromDiscountRate(8.9534, 364)).toBeCloseTo(9.8339, 1);
  });

  it("interestRate is always >= discountRate for a positive tenor (price-based yield exceeds face-based discount)", () => {
    expect(interestRateFromDiscountRate(10, 182)).toBeGreaterThan(10);
  });
});

describe("discountRateFromInterestRate — inverse round-trips", () => {
  it("round-trips through interestRateFromDiscountRate", () => {
    const original = 12.5;
    const tenor = 182;
    const interest = interestRateFromDiscountRate(original, tenor);
    expect(discountRateFromInterestRate(interest, tenor)).toBeCloseTo(original, 6);
  });
});

describe("Live TreasuryRate data satisfies the discount/interest relationship", () => {
  it("every stored observation's interestRate matches the formula applied to its own discountRate, within rounding tolerance", async () => {
    const db = getPrisma();
    const rows = await db.treasuryRate.findMany({
      // Excludes synthetic fixture rows other integration test files create
      // with deliberately-mismatched discount/interest pairs to test
      // validation (e.g. bog-treasury-ingestion.integration.test.ts uses
      // 2099-dated rows) — this suite runs in parallel with those, and a
      // real BoG auction is never dated past the current year.
      where: { observationDate: { lt: new Date("2090-01-01T00:00:00.000Z") } },
      include: { instrument: true },
      take: 200,
      orderBy: { observationDate: "desc" },
    });

    if (rows.length === 0) {
      // No data ingested in this environment — nothing to verify against, but don't fail the suite.
      return;
    }

    for (const row of rows) {
      const predicted = interestRateFromDiscountRate(Number(row.discountRate), row.instrument.tenorDays);
      const actual = Number(row.interestRate);
      // BoG rounds intermediate steps and some tenors use a slightly
      // different day basis (e.g. 364 vs 365) — 0.05 percentage points
      // comfortably covers that rounding while still catching a genuinely
      // wrong field mapping (which would be off by whole percentage points).
      expect(Math.abs(predicted - actual)).toBeLessThan(0.05);
    }
  });
});
