// M9.0.1 — language guardrails for everything the assumption-aware layers generate, plus terminology discipline:
// "Reference Value" is reserved for Korbly-supported valuation; an assumption is never called a market or reference value.
import { describe, expect, it } from "vitest";
import { buildDecisionInsights, buildHoldings, buildQuality, buildScenarioInsight, type InsightContext } from "..";
import { assumedBond, assumedEquity, classRule, gov, mixed, mixedBasis, scenarioFor, workspace } from "./fixtures";

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) x.forEach((v) => strings(v, out));
  else if (x && typeof x === "object") Object.values(x).forEach((v) => strings(v, out));
  return out;
}

const books = {
  mixedBasis: mixedBasis(),
  assumptionOnly: [assumedBond("CORPORATE_BOND", { id: "K", label: "Kasapreko Sep-28", nominal: 2_000_000, maturity: "2030-09-12", assumption: { kind: "PAR", value: null } })],
  withEquityAssumption: [gov({ id: "G", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 }), assumedEquity("NEWCO", 5000, 12)],
  referenceOnly: mixed(),
};
const contexts: InsightContext[] = ["OVERVIEW", "EXPOSURE", "SCENARIO", "QUALITY"];

const textFor = (name: keyof typeof books): string[] => {
  const w = workspace(books[name]);
  const out: string[] = [...strings(buildQuality(w, buildHoldings(w))), ...strings(buildHoldings(w))];
  for (const c of contexts) out.push(...strings(buildDecisionInsights(w, c)));
  for (const tpl of [[classRule("CORPORATE_BOND", 300), classRule("GOVERNMENT_BOND", 200)], [classRule("EQUITY", -10)]]) {
    const s = scenarioFor(books[name], tpl);
    out.push(...strings(buildScenarioInsight({ name: "Test", portfolioId: "pf1", view: s.view, result: s.result })));
  }
  return out;
};

describe("language guardrails still hold with assumptions", () => {
  const joined = (Object.keys(books) as (keyof typeof books)[]).flatMap(textFor).join("\n");
  it("generates a meaningful amount of text", () => expect(joined.length).toBeGreaterThan(5000));
  it("no BUY / SELL / HOLD recommendation", () => {
    expect(joined).not.toMatch(/\bbuy(ing)?\b/i);
    expect(joined).not.toMatch(/\bsell(ing)?\b/i);
    expect(joined).not.toMatch(/\bhold (the|this|your|on)\b|\bstrong (buy|sell)\b|\bhold rating\b|\bshould hold\b/i);
  });
  it("no advice, forecast or unsupported causation", () => {
    expect(joined).not.toMatch(/\b(recommend\w*|we advise|you should|should (buy|sell|reduce|increase|trim|add)|consider (buying|selling|reducing))\b/i);
    expect(joined).not.toMatch(/\b(will (fall|rise|drop|increase|decline|outperform|underperform)|is expected to|forecast(ed)? to|likely to|going to (fall|rise))\b/i);
    expect(joined).not.toMatch(/\b(undervalued|overvalued|cheap|expensive|fair value|caused by|because of the market|due to market)\b/i);
  });
  it("never calls anything dangerous, too high, or an error — an assumption is a disclosed input", () => {
    expect(joined).not.toMatch(/\b(dangerous|too high|too concentrated|excessive|alarming|overweight|underweight)\b/i);
    expect(joined).not.toMatch(/\bassumption[s]? (is|are) (an? )?(error|mistake|wrong|problem)/i);
  });
  it("never uses 'market value'", () => expect(joined).not.toMatch(/market value/i));
  it("makes no profit, return or P&L claim", () => expect(joined).not.toMatch(/\b(profit|annualised return|P&L|gain of|income earned)\b/i));
});

describe("terminology: Reference Value is reserved for Korbly-supported valuation", () => {
  it("a portfolio that includes an assumption never calls its total a Reference Value", () => {
    for (const name of ["mixedBasis", "assumptionOnly", "withEquityAssumption"] as const) {
      const w = workspace(books[name]);
      const text = [...strings(buildDecisionInsights(w, "OVERVIEW")), ...strings(buildDecisionInsights(w, "QUALITY")), ...strings(buildQuality(w, buildHoldings(w)))].join("\n");
      expect(text, name).not.toMatch(/of valued Reference Value|Reference Value of the portfolio|portfolio Reference Value/);
      expect(text, name).toMatch(/Analytical Starting Value/);
    }
  });

  it("a scenario on such a portfolio speaks of starting value, not reference value", () => {
    const s = scenarioFor(books.mixedBasis, [classRule("CORPORATE_BOND", 300)]);
    const i = buildScenarioInsight({ name: "Rate pressure", portfolioId: "pf1", view: s.view, result: s.result });
    expect(i.fact).toMatch(/Analytical Starting Value/);
    expect(i.fact).not.toMatch(/Reference Value/);
    expect(i.evidence.map((e) => e.label)).toContain("Analytical Starting Value");
  });

  it("a portfolio of Korbly-supported values keeps the established Reference Value wording", () => {
    const text = [...strings(buildDecisionInsights(workspace(books.referenceOnly), "OVERVIEW"))].join("\n");
    expect(text).toMatch(/Reference Value/);
    expect(text).not.toMatch(/Analytical Starting Value/);
  });

  it("an assumption holding is described as an assumption, with its assumption stated, in every holdings view", () => {
    const h = buildHoldings(workspace(books.mixedBasis)).find((x) => x.label === "Kasapreko Sep-28")!;
    expect(h.basis).toBe("ANALYST_ASSUMPTION");
    expect(h.assumptionSummary).toBe("28.00% yield");
    expect(h.quality.label).toBe("Analyst assumption — not observed");
    expect(h.quality.recency).toBeNull();
  });
});
