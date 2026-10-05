import { describe, expect, it } from "vitest";
import { buildHoldings, buildMaturityProfile, buildQuality } from "..";
import { bill, corp, equity, gov, mixed, workspace } from "./fixtures";

describe("holdings view model", () => {
  const input = workspace(mixed());
  const holdings = buildHoldings(input);

  it("one row per position, largest Reference Value first, unvalued last", () => {
    expect(holdings).toHaveLength(7);
    const vals = holdings.map((h) => h.referenceValueGhs ?? -1);
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    const withUnvalued = buildHoldings(workspace([...mixed(), gov({ id: "U", nominal: 1, maturity: "2031-01-01", ytm: null })]));
    expect(withUnvalued[withUnvalued.length - 1].status).toBe("UNVALUED");
  });
  it("weights are the holding's share of the portfolio Reference Value and sum to 100%", () => {
    const total = holdings.reduce((s, h) => s + (h.weightPct ?? 0), 0);
    expect(total).toBeCloseTo(100, 6);
    const gcb = holdings.find((h) => h.positionId === "GCB")!;
    expect(gcb.weightPct).toBeCloseTo((gcb.referenceValueGhs! / input.summary.referenceValueGhs!) * 100, 9);
  });
  it("sizes keep their own semantics: nominal, face, shares", () => {
    expect(holdings.find((h) => h.positionId === "GOG34")!.sizeText).toBe("GHS 1,500,000 nominal");
    expect(holdings.find((h) => h.positionId === "B364")!.sizeText).toBe("GHS 1,000,000 face");
    expect(holdings.find((h) => h.positionId === "GCB")!.sizeText).toBe("100,000 shares");
  });
  it("T-bill shows days to maturity (245 for the 364-day bill)", () => {
    expect(holdings.find((h) => h.positionId === "B364")!.daysToMaturity).toBe(245);
    expect(holdings.find((h) => h.positionId === "GCB")!.maturityDate).toBeNull();
  });
  it("rate lens: bonds and bills carry sensitivity, equities do not; per-1pp is 100 × DV01", () => {
    const g = holdings.find((h) => h.positionId === "GOG34")!;
    expect(g.rate!.kind).toBe("BOND_YIELD");
    expect(g.rate!.per1ppGhs).toBeCloseTo(g.rate!.dv01Ghs * 100, 9);
    expect(holdings.find((h) => h.positionId === "B364")!.rate!.kind).toBe("BILL_RATE");
    expect(holdings.find((h) => h.positionId === "GCB")!.rate).toBeNull();
    // matches the M8.2 exposure engine exactly
    const m82 = input.exposures.rates.contributors.find((c) => c.positionId === "GOG34")!;
    expect(g.rate!.dv01Ghs).toBe(m82.dv01Ghs);
  });
  it("quality lens: stale equity explains that the GSE report is current but the stock has not traded", () => {
    const alw = holdings.find((h) => h.positionId === "ALW")!;
    expect(alw.quality.recency).toBe("STALE");
    expect(alw.quality.note).toMatch(/latest GSE report .* is current, but ALW itself has not traded recently/);
  });
  it("T-bill quality carries the indicative-valuation disclosure", () => {
    expect(holdings.find((h) => h.positionId === "B364")!.quality.note).toMatch(/no secondary-market quote is available/);
  });
  it("unvalued holding has no value, no weight and its reason — never zero", () => {
    const u = buildHoldings(workspace([gov({ id: "U", nominal: 1, maturity: "2031-01-01", ytm: null })]))[0];
    expect(u.referenceValueGhs).toBeNull();
    expect(u.weightPct).toBeNull();
    expect(u.unvaluedReason).toMatch(/No market observation/);
  });
  it("inspect links are unique per position (no duplicate ids) and stable", () => {
    const ids = holdings.map((h) => h.positionId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(holdings.map((h) => h.inspectHref)).size).toBe(ids.length);
    expect(buildHoldings(workspace([...mixed()].reverse())).map((h) => h.positionId)).toEqual(ids);
  });
});

describe("maturity profile", () => {
  it("reconciles exactly with the M8.2 contractual ladder", () => {
    const input = workspace(mixed());
    const p = buildMaturityProfile(input);
    expect(p.totalNominalGhs).toBe(input.exposures.maturity.eligibleNominalGhs);
    expect(p.buckets.reduce((s, b) => s + b.nominalGhs, 0)).toBeCloseTo(input.exposures.maturity.eligibleNominalGhs, 6);
    const lt1y = input.exposures.maturity.buckets.find((b) => b.key === "LT_1Y")!.nominalGhs;
    expect(p.buckets[0].nominalGhs + p.buckets[1].nominalGhs).toBeCloseTo(lt1y, 6);
  });
  it("splits the first year at 90 days and counts the 91-day bill as near-term", () => {
    const p = buildMaturityProfile(workspace(mixed()));
    expect(p.buckets[0]).toMatchObject({ key: "LE_90D", nominalGhs: 600_000, positionCount: 1 });
    expect(p.buckets[1]).toMatchObject({ key: "D91_12M", nominalGhs: 1_000_000 });
    expect(p.nearTermNominalGhs).toBe(600_000);
  });
  it("equities have no maturity and do not enter the profile", () => {
    const p = buildMaturityProfile(workspace([equity("E", 1000, 10)]));
    expect(p.totalNominalGhs).toBe(0);
    expect(p.buckets.every((b) => b.nominalPct === null)).toBe(true);
  });
  it("a bond maturing in exactly 90 days is near-term; 91 days is not", () => {
    const p = buildMaturityProfile(workspace([gov({ id: "N", nominal: 100, maturity: "2027-01-03", ytm: 20 }), gov({ id: "M", nominal: 100, maturity: "2027-01-04", ytm: 20 })]));
    expect(p.buckets[0].positionCount).toBe(1);
    expect(p.buckets[1].positionCount).toBe(1);
  });
});

describe("data-quality view", () => {
  it("complete, recent portfolio", () => {
    const input = workspace([equity("A", 1, 1), corp({ id: "C", nominal: 1000, maturity: "2028-09-12", ytm: 24 })]);
    const q = buildQuality(input, buildHoldings(input));
    expect(q.summary).toBe("2 of 2 holdings use recent valuation evidence.");
    expect(q.needsReview).toHaveLength(0);
  });
  it("incomplete coverage: stale + unvalued are counted separately, in calm language", () => {
    const input = workspace([equity("A", 1, 1), equity("ALW", 1, 1, { recency: "STALE" }), gov({ id: "U", nominal: 1, maturity: "2031-01-01", ytm: null })]);
    const q = buildQuality(input, buildHoldings(input));
    expect(q).toMatchObject({ valuedCount: 2, recentCount: 1, staleCount: 1, unvaluedCount: 1 });
    expect(q.summary).toBe("1 of 3 holdings uses recent valuation evidence. 2 holdings need review.");
    expect(q.needsReview.map((r) => r.label).sort()).toEqual(["ALW", "U"]);
  });
  it("nothing valued", () => {
    const input = workspace([gov({ id: "U", nominal: 1, maturity: "2031-01-01", ytm: null })]);
    expect(buildQuality(input, buildHoldings(input)).summary).toBe("None of the 1 holding can be valued yet.");
  });
  it("flags the Treasury-bill disclosure only when a bill is held", () => {
    const withBill = workspace([bill("B", 1000, "2027-06-07", 364)]);
    expect(buildQuality(withBill, buildHoldings(withBill)).hasBillDisclosure).toBe(true);
    const noBill = workspace([equity("A", 1, 1)]);
    expect(buildQuality(noBill, buildHoldings(noBill)).hasBillDisclosure).toBe(false);
  });
});
