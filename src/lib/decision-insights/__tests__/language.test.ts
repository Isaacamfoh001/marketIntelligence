import { describe, expect, it } from "vitest";
import { buildDecisionInsights, buildHoldings, buildQuality, buildScenarioInsight, PLAIN_TERMS } from "..";
import { percentagePoints } from "../../scenario-studio";
import { bill, classRule, corp, equity, gov, mixed, scenarioFor, templateRules, workspace } from "./fixtures";

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => strings(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => strings(v, out));
  return out;
}

const portfolios = {
  mixed: mixed(),
  empty: [],
  billsOnly: [bill("B", 1_000_000, "2027-06-07", 364)],
  equityOnly: [equity("GCB", 1000, 40), equity("ALW", 1000, 1, { recency: "STALE" })],
  withUnvalued: [...mixed(), gov({ id: "U", nominal: 1, maturity: "2031-01-01", ytm: null })],
  corp: [corp({ id: "C", nominal: 1000, maturity: "2028-09-12", ytm: 24 }), equity("E", 10, 10)],
};

const allText = (): string[] => {
  const out: string[] = [];
  for (const ps of Object.values(portfolios)) {
    const w = workspace(ps);
    out.push(...strings(buildDecisionInsights(w)), ...strings(buildQuality(w, buildHoldings(w))), ...strings(buildHoldings(w)));
    if (ps.length > 0) {
      for (const tpl of ["rate-pressure", "broad-selloff", "equity-pullback"]) {
        const s = scenarioFor(ps, templateRules(tpl), tpl);
        out.push(...strings(buildScenarioInsight({ name: tpl, portfolioId: "pf1", view: s.view, result: s.result })));
      }
    }
  }
  return out;
};

describe("language guardrails — generated text", () => {
  const text = allText();
  const joined = text.join("\n");

  it("generates a meaningful amount of text to check", () => expect(text.length).toBeGreaterThan(200));
  it("never says BUY", () => expect(joined).not.toMatch(/\bbuy(ing)?\b/i));
  it("never says SELL", () => expect(joined).not.toMatch(/\bsell(ing)?\b/i));
  it("never says HOLD as a recommendation", () => expect(joined).not.toMatch(/\bhold (the|this|your|on)\b|\bstrong (buy|sell)\b|\bhold rating\b|\bshould hold\b/i));
  it("never recommends or advises", () => expect(joined).not.toMatch(/\b(recommend\w*|we advise|you should|should (buy|sell|reduce|increase|trim|add)|consider (buying|selling|reducing))\b/i));
  it("makes no unsupported forecast", () => expect(joined).not.toMatch(/\b(will (fall|rise|drop|increase|decline|outperform|underperform)|is expected to|forecast(ed)? to|likely to|going to (fall|rise))\b/i));
  it("makes no unsupported valuation or causation claim", () => expect(joined).not.toMatch(/\b(undervalued|overvalued|cheap|expensive|fair value|caused by|because of the market|due to market)\b/i));
  it("calls nothing dangerous, risky or too high", () => expect(joined).not.toMatch(/\b(dangerous|too high|too concentrated|excessive|alarming|overweight|underweight)\b/i));
  it("never misuses 'market value' for Reference Value", () => expect(joined).not.toMatch(/market value/i));
  it("never invents a score or rating", () => expect(joined).not.toMatch(/\b(confidence score|health score|value score|\d\s?\/\s?5|rating of)\b/i));
  it("scenario sentences are framed as 'under …' assumptions", () => {
    const s = scenarioFor(mixed(), templateRules("broad-selloff"));
    const i = buildScenarioInsight({ name: "Broad selloff", portfolioId: "pf1", view: s.view, result: s.result });
    expect(i.fact).toMatch(/^Under /);
    expect(i.interpretation).toMatch(/^Under these assumptions/);
  });
});

describe("plain-language translation", () => {
  it("+200 bps reads as 2.0 percentage points", () => {
    expect(percentagePoints(200)).toBe("2.0 percentage points");
    const s = scenarioFor([gov({ id: "G", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 })], [classRule("GOVERNMENT_BOND", 200)]);
    const i = buildScenarioInsight({ name: "x", portfolioId: "p", view: s.view, result: s.result });
    expect(i.assumptions[0]).toEqual({ technical: "+200 bps", plain: "Government bond yields rise by 2.0 percentage points." });
  });
  it("−25 bps and 175 bps read correctly", () => {
    expect(percentagePoints(25)).toBe("0.25 percentage points");
    expect(percentagePoints(175)).toBe("1.75 percentage points");
  });
  it("technical terms keep a plain gloss and their technical name", () => {
    expect(PLAIN_TERMS.dv01.plain).toMatch(/0\.01 percentage-point/);
    expect(PLAIN_TERMS.dv01.technical).toBe("DV01");
    expect(PLAIN_TERMS.rateSensitivity.technical).toMatch(/duration/i);
  });
  it("Treasury-bill indicative disclosure is present wherever a bill is valued", () => {
    expect(PLAIN_TERMS.billValuation.help).toBe("Indicative valuation using an interpolated Bank of Ghana auction rate; no secondary-market quote is available.");
    const w = workspace(portfolios.billsOnly);
    expect(buildQuality(w, buildHoldings(w)).hasBillDisclosure).toBe(true);
    expect(buildHoldings(w)[0].quality.note).toMatch(/no secondary-market quote is available/);
  });
  it("Reference Value wording is used for values, not return or profit", () => {
    expect(allText().join("\n")).not.toMatch(/\b(profit|annualised return|P&L|gain of|income earned)\b/i);
  });
});
