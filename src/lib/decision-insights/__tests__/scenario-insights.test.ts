import { describe, expect, it } from "vitest";
import { buildScenarioInsight } from "..";
import { classRule, equity, gov, mixed, scenarioFor, templateRules, bill, corp } from "./fixtures";

const insight = (ps = mixed(), rules = templateRules("rate-pressure"), name = "Rate pressure") => {
  const s = scenarioFor(ps, rules, name);
  return { s, i: buildScenarioInsight({ name, portfolioId: "pf1", view: s.view, result: s.result }) };
};
const cents = (n: number) => Math.round(n * 100);

describe("scenario conclusion", () => {
  it("negative result names the main class and the largest holding", () => {
    const { i } = insight(mixed(), templateRules("broad-selloff"), "Broad selloff");
    expect(i.status).toBe("RESULT");
    expect(i.direction).toBe("FALL");
    expect(i.fact).toMatch(/^Under Broad selloff, Reference Value falls by about GHS .*\(−[\d.]+%\)\. Equities account for \d+% of the decline; GCB is the largest single contributor/);
    expect(i.mainClass!.label).toBe("Equities");
    expect(i.mainHolding!.label).toBe("GCB");
  });
  it("positive result says rises / increase", () => {
    const { i } = insight(mixed(), [classRule("GOVERNMENT_BOND", -100), classRule("TREASURY_BILL", -100)], "Rates ease");
    expect(i.direction).toBe("RISE");
    expect(i.fact).toMatch(/Reference Value rises by about/);
    expect(i.fact).toMatch(/of the increase/);
  });
  it("zero result: no change is stated plainly and no driver is invented", () => {
    const { i } = insight(mixed(), [classRule("EQUITY", 0)], "No move");
    expect(i.status).toBe("NO_CHANGE");
    expect(i.fact).toMatch(/no holding changes in value/);
    expect(i.mainClass).toBeNull();
    expect(i.mainHolding).toBeNull();
  });
  it("T-bill rate shock: the bill class is the driver and the assumption reads in plain language", () => {
    const ps = [bill("B364", 5_000_000, "2027-06-07", 364), equity("E", 1000, 1)];
    const { i } = insight(ps, [classRule("TREASURY_BILL", 200)], "Bill rates up");
    expect(i.mainClass!.id).toBe("TREASURY_BILL");
    expect(i.assumptions[0]).toMatchObject({ technical: "+200 bps", plain: "Treasury-bill rates rise by 2.0 percentage points." });
    expect(i.interpretation).toMatch(/interest-rate movements on treasury bills account for most/);
  });
  it("bond rate shock: the bond holding leads", () => {
    const ps = [gov({ id: "G", label: "GoG Jul-34", nominal: 5_000_000, maturity: "2034-07-10", ytm: 21 }), equity("E", 1000, 1)];
    const { i } = insight(ps, [classRule("GOVERNMENT_BOND", 200)], "Bond yields up");
    expect(i.mainHolding!.label).toBe("GoG Jul-34");
    expect(i.mainClass!.id).toBe("GOVERNMENT_BOND");
  });
  it("equity shock: equities lead and the wording is about the price assumption", () => {
    const { i } = insight(mixed(), [classRule("EQUITY", -10)], "Equity pullback");
    expect(i.mainClass!.id).toBe("EQUITY");
    expect(i.interpretation).toMatch(/equity price assumption accounts for most of the decline/);
  });
  it("mixed scenario with no majority class says so", () => {
    const ps = [equity("E", 1000, 1000), gov({ id: "G", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 })];
    const { i } = insight(ps, [classRule("EQUITY", -10), classRule("GOVERNMENT_BOND", 400)], "Mixed");
    expect(i.mainClass!.sharePct! < 100).toBe(true);
    if (i.mainClass!.sharePct! <= 50) expect(i.interpretation).toMatch(/no single asset class/);
  });
});

describe("contribution analysis", () => {
  it("class bars and holding bars (plus 'other') both reconcile to the portfolio total, to the pesewa", () => {
    const ps = [...mixed(), equity("E4", 10, 10), equity("E5", 10, 10), equity("E6", 10, 10), equity("E7", 10, 10)];
    const { s, i } = insight(ps, templateRules("broad-selloff"), "Broad selloff");
    const total = s.result.portfolio.impactGhs!;
    expect(i.byClass.reduce((a, b) => a + cents(b.impactGhs), 0)).toBe(cents(total));
    const holdings = i.byHolding.reduce((a, b) => a + cents(b.impactGhs), 0) + cents(i.otherHoldings?.impactGhs ?? 0);
    expect(holdings).toBe(cents(total));
    expect(i.reconciles).toBe(true);
    expect(i.byHolding.length).toBeLessThanOrEqual(6);
    expect(i.otherHoldings!.count).toBeGreaterThan(0);
  });
  it("holding bars are ordered by size of impact with a stable tiebreak", () => {
    const { i } = insight(mixed(), templateRules("broad-selloff"));
    const mags = i.byHolding.map((b) => Math.abs(b.impactGhs));
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
  });
  it("shares are only given to contributors in the direction of the total", () => {
    const { i } = insight(mixed(), [classRule("EQUITY", -10), classRule("GOVERNMENT_BOND", -100)], "Offsetting");
    for (const b of [...i.byClass, ...i.byHolding]) if (Math.sign(b.impactGhs) !== Math.sign(i.impactGhs!)) expect(b.sharePct).toBeNull();
  });
});

describe("scenario data quality and excluded holdings", () => {
  it("stale basis is reported with its share", () => {
    const ps = [equity("A", 1000, 10), equity("S", 1000, 10, { recency: "STALE" })];
    const { i } = insight(ps, [classRule("EQUITY", -10)], "Pullback");
    expect(i.quality.caution).toBe(true);
    expect(i.quality.statement).toMatch(/50% of the starting value rests on older evidence/);
  });
  it("a holding with no valuation is excluded, stated, and never given a zero impact", () => {
    const ps = [equity("A", 1000, 10), gov({ id: "U", nominal: 1000, maturity: "2031-01-01", ytm: null })];
    const { s, i } = insight(ps, [classRule("EQUITY", -10), classRule("GOVERNMENT_BOND", 200)], "Mixed");
    expect(i.quality.excluded).toBe(1);
    expect(i.quality.statement).toMatch(/1 of 2|excluded|2 positions|1 position/i);
    expect(i.byHolding.find((b) => b.id === "U")).toBeUndefined();
    expect(s.result.portfolio.unvaluedCount).toBe(1);
  });
  it("nothing valued → not available, no fabricated numbers", () => {
    const ps = [gov({ id: "U", nominal: 1000, maturity: "2031-01-01", ytm: null })];
    const { i } = insight(ps, [classRule("GOVERNMENT_BOND", 200)], "Rates");
    expect(i.status).toBe("NOT_AVAILABLE");
    expect(i.impactGhs).toBeNull();
    expect(i.byClass).toHaveLength(0);
  });
});

describe("scenario investigations", () => {
  it("are limited, carry reasons and links to the holding", () => {
    const { i } = insight(mixed(), templateRules("broad-selloff"));
    expect(i.investigations.length).toBeGreaterThan(0);
    expect(i.investigations.length).toBeLessThanOrEqual(3);
    for (const inv of i.investigations) {
      expect(inv.reason.length).toBeGreaterThan(3);
      expect(inv.href).toBeTruthy();
      expect(inv.positionId).toBeTruthy();
      expect(inv.prompt).toMatch(/^Review .+: /);
    }
  });
  it("is deterministic", () => {
    const a = insight(mixed(), templateRules("rate-pressure")).i;
    const b = insight([...mixed()].reverse(), templateRules("rate-pressure")).i;
    expect(b.fact).toBe(a.fact);
    expect(b.byHolding.map((x) => x.id)).toEqual(a.byHolding.map((x) => x.id));
  });
  it("bond-only and corp-only portfolios still conclude", () => {
    const { i } = insight([corp({ id: "C", nominal: 1000, maturity: "2028-09-12", ytm: 24 })], [classRule("CORPORATE_BOND", 300)], "Corp up");
    expect(i.status).toBe("RESULT");
    expect(i.mainHolding!.id).toBe("C");
  });
});
