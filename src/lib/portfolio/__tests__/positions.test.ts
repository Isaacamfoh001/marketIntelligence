import { describe, expect, it } from "vitest";
import { checkBondAddable, checkEquityAddable, findExistingPosition, MAX_SHARES, parseEnteredNumber, validatePositionDraft, type PositionHolding } from "..";

describe("position representation", () => {
  it("accepts a bond as a nominal GHS amount only", () => {
    expect(validatePositionDraft({ assetClass: "BOND", nominalGhs: 2_000_000, currency: "GHS" })).toEqual({ ok: true, assetClass: "BOND", nominalGhs: 2_000_000 });
  });

  it("accepts an equity as whole shares only", () => {
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: 100_000, currency: "GHS" })).toEqual({ ok: true, assetClass: "EQUITY", shares: 100_000 });
  });

  it("rejects the ambiguous mixed-quantity shapes", () => {
    expect(validatePositionDraft({ assetClass: "BOND", nominalGhs: 1000, shares: 5, currency: "GHS" })).toMatchObject({ ok: false });
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: 5, nominalGhs: 1000, currency: "GHS" })).toMatchObject({ ok: false });
  });

  it.each([0, -1, -0.01])("rejects a bond nominal of %s (no zero or short positions)", (n) => {
    expect(validatePositionDraft({ assetClass: "BOND", nominalGhs: n, currency: "GHS" })).toMatchObject({ ok: false });
  });

  it.each([0, -5])("rejects equity shares of %s", (s) => {
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: s, currency: "GHS" })).toMatchObject({ ok: false });
  });

  it("rejects fractional equity shares", () => {
    const r = validatePositionDraft({ assetClass: "EQUITY", shares: 10.5, currency: "GHS" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/whole number/);
  });

  it("rejects missing, NaN and infinite sizes", () => {
    expect(validatePositionDraft({ assetClass: "BOND", currency: "GHS" })).toMatchObject({ ok: false });
    expect(validatePositionDraft({ assetClass: "BOND", nominalGhs: Number.NaN, currency: "GHS" })).toMatchObject({ ok: false });
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: Number.POSITIVE_INFINITY, currency: "GHS" })).toMatchObject({ ok: false });
  });

  it("rejects non-GHS instruments for both asset classes", () => {
    expect(validatePositionDraft({ assetClass: "BOND", nominalGhs: 1000, currency: "USD" })).toMatchObject({ ok: false });
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: 10, currency: "USD" })).toMatchObject({ ok: false });
  });

  it("rejects sub-pesewa nominals and share counts beyond the column", () => {
    expect(validatePositionDraft({ assetClass: "BOND", nominalGhs: 100.005, currency: "GHS" })).toMatchObject({ ok: false });
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: MAX_SHARES + 1, currency: "GHS" })).toMatchObject({ ok: false });
    expect(validatePositionDraft({ assetClass: "EQUITY", shares: MAX_SHARES, currency: "GHS" })).toMatchObject({ ok: true });
  });
});

describe("mixed portfolio and duplicates", () => {
  const holdings: PositionHolding[] = [
    { assetClass: "BOND", positionId: "p1", fixedIncomeSecurityId: "b1", nominalGhs: 1_000_000 },
    { assetClass: "EQUITY", positionId: "p2", securityId: "s1", shares: 500 },
  ];

  it("finds the existing position for the same bond or equity (one position per instrument)", () => {
    expect(findExistingPosition(holdings, { assetClass: "BOND", fixedIncomeSecurityId: "b1" })?.positionId).toBe("p1");
    expect(findExistingPosition(holdings, { assetClass: "EQUITY", securityId: "s1" })?.positionId).toBe("p2");
  });

  it("does not match different instruments, or a bond id against an equity id", () => {
    expect(findExistingPosition(holdings, { assetClass: "BOND", fixedIncomeSecurityId: "b2" })).toBeNull();
    expect(findExistingPosition(holdings, { assetClass: "EQUITY", securityId: "b1" })).toBeNull();
  });
});

describe("parseEnteredNumber", () => {
  it("parses grouped and plain numbers strictly", () => {
    expect(parseEnteredNumber("2,000,000")).toBe(2_000_000);
    expect(parseEnteredNumber(" 150.25 ")).toBe(150.25);
    expect(parseEnteredNumber("")).toBeNull();
    expect(parseEnteredNumber("12abc")).toBeNull();
    expect(parseEnteredNumber("1e6")).toBeNull();
  });
});

describe("instrument eligibility", () => {
  it("blocks matured, floating-rate and non-GHS bonds; allows outstanding fixed and zero-coupon", () => {
    expect(checkBondAddable({ currency: "GHS", lifecycle: "MATURED", couponType: "FIXED" })).toMatchObject({ addable: false });
    expect(checkBondAddable({ currency: "GHS", lifecycle: "ACTIVE", couponType: "FLOATING" })).toMatchObject({ addable: false });
    expect(checkBondAddable({ currency: "USD", lifecycle: "ACTIVE", couponType: "FIXED" })).toMatchObject({ addable: false });
    expect(checkBondAddable({ currency: "GHS", lifecycle: "ACTIVE", couponType: "FIXED" })).toEqual({ addable: true });
    expect(checkBondAddable({ currency: "GHS", lifecycle: "MATURING_SOON", couponType: "ZERO_COUPON" })).toEqual({ addable: true });
  });

  it("blocks inactive and non-GHS equities", () => {
    expect(checkEquityAddable({ currency: "GHS", active: false })).toMatchObject({ addable: false });
    expect(checkEquityAddable({ currency: "USD", active: true })).toMatchObject({ addable: false });
    expect(checkEquityAddable({ currency: "GHS", active: true })).toEqual({ addable: true });
  });
});
