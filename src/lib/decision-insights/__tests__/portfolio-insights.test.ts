import { describe, expect, it } from "vitest";
import { buildDecisionInsights, MAX_INSIGHTS, MAX_INVESTIGATIONS, type Insight } from "..";
import { bill, corp, equity, gov, mixed, workspace } from "./fixtures";

const kinds = (xs: Insight[]) => xs.map((i) => i.kind);

describe("empty and single-holding portfolios", () => {
  it("empty portfolio → nothing to conclude", () => {
    expect(buildDecisionInsights(workspace([]))).toEqual({ context: "OVERVIEW", primary: null, insights: [], investigations: [] });
  });
  it("one holding → a factual conclusion with no invented concentration warning", () => {
    const r = buildDecisionInsights(workspace([equity("GCB", 100_000, 40)]));
    expect(r.primary?.kind).toBe("PORTFOLIO");
    expect(r.primary?.fact).toMatch(/100%|Equities are/);
    expect(r.insights.length).toBeGreaterThan(0);
  });
});

describe("mixed portfolio", () => {
  const r = buildDecisionInsights(workspace(mixed()));

  it("dominant asset class is the largest class by valued Reference Value", () => {
    const cls = r.insights.find((i) => i.kind === "DOMINANT_ASSET_CLASS")!;
    expect(cls.fact).toMatch(/^Equities are \d+% of valued Reference Value/);
    expect(cls.interpretation).toMatch(/More than half/);
  });
  it("largest issuer is reported with its share and evidence", () => {
    const i = r.insights.find((x) => x.kind === "LARGEST_ISSUER")!;
    expect(i.fact).toMatch(/GCB PLC is the largest issuer exposure: \d+%/);
    expect(i.evidence.length).toBeGreaterThan(0);
  });
  it("largest holding is suppressed when its issuer insight already says the same thing", () => {
    expect(kinds(r.insights)).not.toContain("LARGEST_HOLDING");
  });
  it("largest rate driver names the holding, with an investigation prompt that is not advice", () => {
    const all = buildDecisionInsights(workspace(mixed()));
    // the rate driver may be ranked out of the top four; test it directly on a fixed-income-heavy book
    const fi = buildDecisionInsights(workspace([gov({ id: "G1", label: "GoG Jul-34", nominal: 5_000_000, maturity: "2034-07-10", ytm: 21 }), gov({ id: "G2", label: "GoG Mar-27", nominal: 5_000_000, maturity: "2027-03-08", ytm: 20 })]));
    const rate = fi.insights.find((i) => i.kind === "RATE_DRIVER")!;
    expect(rate.fact).toMatch(/GoG Jul-34 is the largest source of rate sensitivity/);
    expect(fi.investigations.some((i) => /largest rate-sensitive holding/.test(i.prompt))).toBe(true);
    expect(all.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
  });
  it("near-maturity insight quantifies principal due within 90 days", () => {
    const fi = buildDecisionInsights(workspace([bill("B91", 2_000_000, "2026-12-04", 91), gov({ id: "G1", nominal: 500_000, maturity: "2034-07-10", ytm: 21 })]));
    const n = fi.insights.find((i) => i.kind === "NEAR_MATURITY")!;
    expect(n.fact).toMatch(/GHS 2.00m of principal across 1 holding .* matures within 90 days/);
    expect(n.interpretation).toMatch(/of the portfolio's contractual fixed-income principal/);
  });
  it("stale evidence names the stale holdings and their share", () => {
    const stale = buildDecisionInsights(workspace([equity("A", 1000, 10), equity("ALW", 1000, 10, { recency: "STALE" })]));
    const s = stale.insights.find((i) => i.kind === "STALE_EVIDENCE")!;
    expect(s.fact).toMatch(/1 of 2 valued holdings \(ALW\) rests on older evidence — 50%/);
    const inv = stale.investigations.find((i) => i.kind === "STALE_EVIDENCE")!;
    expect(inv.prompt).toMatch(/Review ALW's valuation evidence/);
    expect(inv.prompt).toMatch(/latest GSE report .* is current, but ALW itself has not traded recently/);
  });
  it("respects the insight and investigation limits", () => {
    expect(r.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
    expect(r.investigations.length).toBeLessThanOrEqual(MAX_INVESTIGATIONS);
  });
  it("ranks only WITHIN a dimension: each dimension's findings are ordered by that dimension's own share, never against another dimension's", () => {
    const byDim = new Map<string, number[]>();
    for (const i of buildDecisionInsights(workspace(mixed())).insights) byDim.set(i.dimension, [...(byDim.get(i.dimension) ?? []), i.share ?? -1]);
    for (const shares of byDim.values()) expect(shares).toEqual([...shares].sort((a, b) => b - a));
  });
  it("every insight names its dimension and the denominator its share is a share OF, and carries evidence (traceability)", () => {
    for (const i of r.insights) {
      expect(i.shareBasis.length).toBeGreaterThan(5);
      expect(i.dimension).toBeTruthy();
      expect(i.evidence.length).toBeGreaterThan(0);
    }
    expect(r.primary!.basedOn.every((id) => r.insights.some((i) => i.id === id))).toBe(true);
  });
  it("every investigation has a reason and a place to go", () => {
    for (const inv of r.investigations) {
      expect(inv.reason.length).toBeGreaterThan(3);
      expect(inv.href).toMatch(/^\/portfolios\/pf1/);
      expect(inv.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe("unvalued exposure", () => {
  const ps = [gov({ id: "G1", label: "GoG A", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 }), gov({ id: "G2", label: "GoG B", nominal: 500_000, maturity: "2031-07-10", ytm: null })];
  const r = buildDecisionInsights(workspace(ps));
  it("is the first insight and says excluded holdings are not counted as zero", () => {
    expect(r.insights[0].kind).toBe("UNVALUED_EXPOSURE");
    expect(r.insights[0].fact).toMatch(/GoG B\) cannot be valued and is left out/);
    expect(r.insights[0].interpretation).toMatch(/not counted as zero/);
  });
  it("is not itself the primary conclusion", () => {
    expect(r.primary!.basedOn[0]).not.toBe("unvalued");
  });
  it("when nothing can be valued the conclusion says so instead of inventing structure", () => {
    const none = buildDecisionInsights(workspace([gov({ id: "G2", nominal: 500_000, maturity: "2031-07-10", ytm: null })]));
    expect(none.primary).toMatchObject({ kind: "NOT_VALUED" });
    expect(none.primary!.fact).toMatch(/None of the 1 holding can be valued yet/);
  });
});

describe("determinism and tie-breaking", () => {
  it("same data → identical output, regardless of input order", () => {
    const a = buildDecisionInsights(workspace(mixed()));
    const b = buildDecisionInsights(workspace([...mixed()].reverse()));
    expect(b).toEqual(a);
    expect(buildDecisionInsights(workspace(mixed()))).toEqual(a);
  });
  it("equal materiality breaks by a fixed kind order, then id", () => {
    // Two equal equities: both 50%. The largest-holding/issuer tie must resolve the same way every time.
    const ps = [equity("AAA", 1000, 10), equity("BBB", 1000, 10)];
    const a = buildDecisionInsights(workspace(ps));
    const b = buildDecisionInsights(workspace([ps[1], ps[0]]));
    expect(a.insights.map((i) => i.id)).toEqual(b.insights.map((i) => i.id));
  });
  it("there is no universal score: rate and maturity shares are shares of THEIR OWN denominators, unscaled", () => {
    const fi = buildDecisionInsights(workspace([gov({ id: "G1", label: "GoG Jul-34", nominal: 5_000_000, maturity: "2034-07-10", ytm: 21 }), equity("E", 100_000, 100)]));
    const rate = fi.insights.find((i) => i.kind === "RATE_DRIVER")!;
    expect(rate.dimension).toBe("RATE_SENSITIVITY");
    // The only rate-sensitive holding carries 100% of the MEASURED sensitivity, even though equities hold half the value.
    expect(rate.share).toBeCloseTo(100, 9);
    expect(rate.shareBasis).toMatch(/measured rate sensitivity/);
  });
});

describe("corporate issuer linking", () => {
  it("a company's bond and equity are one issuer exposure", () => {
    const co = { companyId: "co-x", issuerName: "X Corp" };
    const r = buildDecisionInsights(workspace([corp({ id: "XB", nominal: 1_000_000, maturity: "2028-09-12", ytm: 24, issuer: co }), equity("XE", 100_000, 10, { issuer: co }), gov({ id: "G", nominal: 100_000, maturity: "2030-01-01", ytm: 20 })]));
    const i = r.insights.find((x) => x.kind === "LARGEST_ISSUER")!;
    expect(i.fact).toMatch(/X Corp is the largest issuer exposure/);
    expect(i.interpretation).toMatch(/2 holdings across 2 asset classes/);
  });
});
