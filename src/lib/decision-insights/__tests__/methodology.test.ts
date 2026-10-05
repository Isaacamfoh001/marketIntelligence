// M9.0.1 — Decision Insight methodology: ranking WITHIN dimensions on natural denominators, deterministic context policy for
// which dimensions lead, context-sensitive conclusions (FACT → MEANING), separate investigation priority.
import { describe, expect, it } from "vitest";
import { buildDecisionInsights, buildQuality, buildHoldings, buildScenarioInsight, INVESTIGATION_PRIORITY, LIST_ORDER, MATERIAL_SHARE_PCT, MAX_INSIGHTS, MAX_INVESTIGATIONS, PRIMARY_ORDER, rankComposition, rankConcentration, rankDataQuality, rankMaturity, rankRate, rankUnvalued, rankValuationBasis, selectFindings, buildFindings, type InsightContext } from "..";
import { assumedBond, assumedEquity, bill, classRule, corp, equity, gov, mixed, mixedBasis, scenarioFor, workspace } from "./fixtures";

const ctxs: InsightContext[] = ["OVERVIEW", "EXPOSURE", "SCENARIO", "QUALITY"];

describe("within-dimension ranking, each on its NATURAL denominator", () => {
  it("composition: asset classes by share of value, deterministic tie order", () => {
    const w = workspace(mixed());
    const r = rankComposition(w.exposures);
    expect(r.map((c) => c.sharePct)).toEqual([...r.map((c) => c.sharePct)].sort((a, b) => b - a));
    expect(r.reduce((s, c) => s + c.sharePct, 0)).toBeCloseTo(100, 9);
    // The order never depends on the order the holdings were entered.
    const fwd = rankComposition(workspace([gov({ id: "A", nominal: 1_000_000, maturity: "2034-07-10", ytm: 20 }), equity("E", 1000, 1_000)]).exposures);
    const rev = rankComposition(workspace([equity("E", 1000, 1_000), gov({ id: "A", nominal: 1_000_000, maturity: "2034-07-10", ytm: 20 })]).exposures);
    expect(rev).toEqual(fwd);
  });

  it("concentration: issuers by share of value; a company's bond and equity are one issuer", () => {
    const co = { companyId: "co-x", issuerName: "X Corp" };
    const w = workspace([corp({ id: "XB", nominal: 1_000_000, maturity: "2028-09-12", ytm: 24, issuer: co }), equity("XE", 100_000, 10, { issuer: co }), gov({ id: "G", nominal: 100_000, maturity: "2030-01-01", ytm: 20 })]);
    const r = rankConcentration(w.exposures);
    expect(r[0].issuer.name).toBe("X Corp");
    expect(r[0].valuedCount).toBe(2);
  });

  it("rate sensitivity: holdings by share of MEASURED sensitivity (not scaled by anything), classes sum to 100%", () => {
    const w = workspace([gov({ id: "L", label: "Long", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 }), gov({ id: "S", label: "Short", nominal: 1_000_000, maturity: "2027-03-08", ytm: 20 }), equity("E", 1_000_000, 100)]);
    const r = rankRate(buildHoldings(w))!;
    expect(r.holdings[0].holding.label).toBe("Long");
    expect(r.holdings.reduce((s, h) => s + h.sharePct, 0)).toBeCloseTo(100, 9);
    expect(r.classes.reduce((s, c) => s + c.sharePct, 0)).toBeCloseTo(100, 9);
    expect(r.assumptionSharePct).toBe(0);
    expect(rankRate(buildHoldings(workspace([equity("E", 10, 10)])))).toBeNull();
  });

  it("rate sensitivity reports the share resting on an analyst-assumed starting yield", () => {
    const w = workspace(mixedBasis());
    const r = rankRate(buildHoldings(w))!;
    expect(r.assumptionSharePct).toBeGreaterThan(0);
    expect(r.assumptionSharePct).toBeLessThan(100);
  });

  it("maturity: near-term holdings soonest first, share of CONTRACTUAL principal", () => {
    const w = workspace([bill("B91", 2_000_000, "2026-12-04", 91), bill("B182", 1_000_000, "2026-12-20", 182), gov({ id: "G", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 })]);
    const holdings = buildHoldings(w);
    const total = holdings.reduce((s, h) => s + (h.principalGhs ?? 0), 0);
    const r = rankMaturity(holdings, total);
    expect(r.map((x) => x.holding.daysToMaturity)).toEqual([...r.map((x) => x.holding.daysToMaturity!)].sort((a, b) => a - b));
    expect(r[0].sharePct).toBeCloseTo((r[0].holding.principalGhs! / total) * 100, 9);
  });

  it("data quality: stale holdings by affected amount, share of the valued total", () => {
    const w = workspace([equity("A", 1000, 10), equity("OLD1", 1000, 10, { recency: "STALE" }), equity("OLD2", 3000, 10, { recency: "STALE" })]);
    const r = rankDataQuality(buildHoldings(w), w.summary.referenceValueGhs);
    expect(r.map((x) => x.holding.label)).toEqual(["OLD2", "OLD1"]);
    expect(r[0].sharePct).toBeCloseTo(60, 9);
  });

  it("valuation basis: assumption-based holdings by value, with share of the total AND of the assumptions", () => {
    const w = workspace([...mixedBasis(), assumedEquity("SMALL", 1_000, 5)]);
    const r = rankValuationBasis(buildHoldings(w), w.summary.referenceValueGhs);
    expect(r[0].holding.label).toBe("Kasapreko Sep-28");
    expect(r.reduce((s, x) => s + x.shareOfAssumptionsPct, 0)).toBeCloseTo(100, 9);
    expect(r[0].sharePct).toBeLessThan(100);
  });

  it("unvalued: no value denominator — ordered by the principal still excluded, largest first", () => {
    const w = workspace([gov({ id: "U1", label: "Small", nominal: 100_000, maturity: "2031-01-01", ytm: null }), gov({ id: "U2", label: "Big", nominal: 900_000, maturity: "2031-01-01", ytm: null }), equity("E", 10, 10)]);
    expect(rankUnvalued(buildHoldings(w)).map((h) => h.label)).toEqual(["Big", "Small"]);
  });
});

describe("cross-dimension selection is a deterministic POLICY, not a score", () => {
  it("shares from different dimensions are never compared: policy order wins even when a later dimension has the bigger number", () => {
    const w = workspace([gov({ id: "G", nominal: 1_000_000, maturity: "2034-07-10", ytm: 21 }), equity("E", 100_000, 30)]);
    const shown = selectFindings(buildFindings(w), "OVERVIEW");
    const rate = shown.find((f) => f.dimension === "RATE_SENSITIVITY")!;
    const composition = shown.find((f) => f.dimension === "COMPOSITION")!;
    expect(rate.insight.share).toBeCloseTo(100, 9); // the only rate-sensitive holding carries all measured sensitivity …
    expect(composition.insight.share!).toBeLessThan(rate.insight.share!); // … a larger number than composition's …
    expect(shown.indexOf(composition)).toBeLessThan(shown.indexOf(rate)); // … yet composition leads on the Overview, by policy.
    expect(LIST_ORDER.OVERVIEW.indexOf("COMPOSITION")).toBeLessThan(LIST_ORDER.OVERVIEW.indexOf("RATE_SENSITIVITY"));
  });

  it("context decides who leads: Overview → composition, Exposure → rate sensitivity, Quality → valuation basis", () => {
    const w = workspace(mixedBasis());
    expect(buildDecisionInsights(w, "OVERVIEW").primary!.dimension).toBe("COMPOSITION");
    expect(buildDecisionInsights(w, "EXPOSURE").primary!.dimension).toBe("RATE_SENSITIVITY");
    expect(buildDecisionInsights(w, "QUALITY").primary!.dimension).toBe("VALUATION_BASIS");
    expect(PRIMARY_ORDER.OVERVIEW[0]).toBe("COMPOSITION");
  });

  it("falls back deterministically when a context's own dimension has nothing to say", () => {
    const w = workspace([equity("E", 1000, 10), equity("F", 1000, 10)]);
    expect(buildDecisionInsights(w, "EXPOSURE").primary!.dimension).toBe("CONCENTRATION"); // no rate-sensitive holding
    expect(buildDecisionInsights(w, "QUALITY").primary!.dimension).toBe("COMPOSITION"); // no assumptions, nothing stale
  });

  it("is deterministic in every context, independent of input order", () => {
    for (const c of ctxs) {
      const a = buildDecisionInsights(workspace(mixedBasis()), c);
      const b = buildDecisionInsights(workspace([...mixedBasis()].reverse()), c);
      expect(b).toEqual(a);
    }
  });

  it("never shows more than MAX_INSIGHTS insights or MAX_INVESTIGATIONS investigations", () => {
    for (const c of ctxs) {
      const r = buildDecisionInsights(workspace([...mixedBasis(), ...mixed().map((p) => ({ ...p, positionId: `x-${p.positionId}`, label: `x-${p.label}` }))]), c);
      expect(r.insights.length).toBeLessThanOrEqual(MAX_INSIGHTS);
      expect(r.investigations.length).toBeLessThanOrEqual(MAX_INVESTIGATIONS);
    }
  });

  it("what is EXCLUDED leads the list, then how much rests on assumptions (explicit policy)", () => {
    const r = buildDecisionInsights(workspace(mixedBasis()), "OVERVIEW");
    expect(r.insights.map((i) => i.dimension).slice(0, 2)).toEqual(["UNVALUED", "VALUATION_BASIS"]);
  });
});

describe("context-sensitive primary conclusions state FACT → MEANING", () => {
  it("overview: says what dominates, with amount, share and what it means", () => {
    const r = buildDecisionInsights(workspace([equity("GCB", 100_000, 40), equity("MTN", 100_000, 6.5), gov({ id: "G", nominal: 500_000, maturity: "2034-07-10", ytm: 21 })]), "OVERVIEW");
    expect(r.primary!.fact).toMatch(/^This portfolio is primarily invested in equities\. Equities are \d+% \(GHS [\d.]+[mk]\) of Reference Value/);
    expect(r.primary!.interpretation).toMatch(/main driver of overall value/);
  });

  it("overview with assumptions names the Analytical Starting Value and discloses the assumed share", () => {
    const r = buildDecisionInsights(workspace(mixedBasis()), "OVERVIEW");
    expect(r.primary!.fact).toMatch(/Analytical Starting Value/);
    expect(r.primary!.fact).not.toMatch(/Reference Value/);
    expect(r.primary!.interpretation).toMatch(/\d+% of this value rests on analyst assumptions/);
  });

  it("exposure: says where measured rate sensitivity sits", () => {
    const r = buildDecisionInsights(workspace([gov({ id: "L", label: "GoG Jul-34", nominal: 5_000_000, maturity: "2034-07-10", ytm: 21 }), corp({ id: "C", nominal: 100_000, maturity: "2028-09-12", ytm: 24 }), equity("E", 1000, 10)]), "EXPOSURE");
    expect(r.primary!.fact).toMatch(/^Most of the measured interest-rate sensitivity \(\d+%\) comes from government bonds, led by GoG Jul-34\./);
    expect(r.primary!.interpretation).toMatch(/first-order estimate, not a forecast/);
  });

  it("quality: says how much depends on assumptions", () => {
    const r = buildDecisionInsights(workspace(mixedBasis()), "QUALITY");
    expect(r.primary!.fact).toMatch(/^Most of this portfolio uses Korbly-supported valuation, but \d+% of Analytical Starting Value depends on analyst assumptions\./);
    expect(r.primary!.interpretation).toMatch(/largest assumption-based position \(28\.00% yield/);
  });

  it("a conclusion is not a bare metric: it carries a sentence of meaning, not only a number", () => {
    for (const c of ctxs) {
      const p = buildDecisionInsights(workspace(mixedBasis()), c).primary!;
      expect(p.fact.length).toBeGreaterThan(40);
      expect(p.interpretation).toBeTruthy();
    }
  });

  it("nothing valued → says so and points to what to do; never invents structure", () => {
    const r = buildDecisionInsights(workspace([gov({ id: "U", nominal: 1, maturity: "2031-01-01", ytm: null })]), "QUALITY");
    expect(r.primary).toMatchObject({ kind: "NOT_VALUED" });
    expect(r.primary!.interpretation).toMatch(/assumption/);
  });
});

describe("assumption insights", () => {
  const w = workspace(mixedBasis());
  const r = buildDecisionInsights(w, "OVERVIEW");
  const a = r.insights.find((i) => i.kind === "ASSUMPTION_DEPENDENCE")!;

  it("reports the share of Analytical Starting Value that depends on assumptions — as a disclosed input, not an error", () => {
    expect(a.fact).toMatch(/^\d+% of Analytical Starting Value \(GHS [\d.]+[mk]\) depends on analyst valuation assumptions\./);
    expect(a.share).toBeCloseTo(w.summary.assumptionPct!, 9);
    expect(a.interpretation).toMatch(/disclosed analytical inputs, not observed prices/);
    expect(a.interpretation).not.toMatch(/\b(error|wrong|problem|warning)\b/i);
  });

  it("names the largest assumption-based position with its assumption", () => {
    expect(a.interpretation).toMatch(/Kasapreko Sep-28 is the largest assumption-based position \(28\.00% yield/);
  });

  it("states that the unvalued holding is excluded because neither Korbly nor the analyst supplied a basis", () => {
    const q = buildDecisionInsights(w, "QUALITY");
    expect(q.primary!.dimension).toBe("VALUATION_BASIS");
    const unvalued = buildFindings(w).find((f) => f.dimension === "UNVALUED")!;
    expect(unvalued.conclusions.QUALITY!.fact).toMatch(/neither Korbly nor an analyst assumption supplies a usable valuation/);
  });

  it("no assumptions → no assumption insight", () => {
    expect(buildDecisionInsights(workspace(mixed())).insights.some((i) => i.kind === "ASSUMPTION_DEPENDENCE")).toBe(false);
  });

  it("the largest holding states when its own value rests on an assumption", () => {
    // Two holdings of one issuer, so the issuer finding does not already say it (the largest-holding finding is then shown).
    const big = workspace([assumedBond("CORPORATE_BOND", { id: "BIG", label: "BigBond", nominal: 9_000_000, maturity: "2030-01-01", assumption: { kind: "YIELD_PCT", value: 26 } }), corp({ id: "SMALL", label: "SmallBond", nominal: 100_000, maturity: "2028-09-12", ytm: 24 }), equity("E", 1000, 10)]);
    const holding = buildFindings(big).find((f) => f.insight.kind === "LARGEST_HOLDING");
    expect(holding?.insight.interpretation).toMatch(/uses an analyst assumption \(26\.00% yield\)/);
  });
});

describe("investigation priority is its own policy", () => {
  it("an unvalued holding ranks first even though it has no value denominator", () => {
    const r = buildDecisionInsights(workspace(mixedBasis()), "OVERVIEW");
    expect(r.investigations[0].kind).toBe("UNVALUED_EXPOSURE");
    expect(r.investigations[0].priority).toBe(INVESTIGATION_PRIORITY.UNVALUED);
  });

  it("a MATERIAL assumption (≥ the stated share of its own denominator) produces an investigation; a small one does not", () => {
    const big = buildDecisionInsights(workspace(mixedBasis()));
    expect(big.investigations.some((i) => i.kind === "ASSUMPTION_DEPENDENCE")).toBe(true);
    const tiny = workspace([gov({ id: "G", nominal: 9_000_000, maturity: "2034-07-10", ytm: 21 }), assumedEquity("TINY", 10, 1)]);
    expect(tiny.summary.assumptionPct!).toBeLessThan(MATERIAL_SHARE_PCT);
    const r = buildDecisionInsights(tiny);
    expect(r.insights.some((i) => i.kind === "ASSUMPTION_DEPENDENCE")).toBe(true); // still disclosed …
    expect(r.investigations.some((i) => i.kind === "ASSUMPTION_DEPENDENCE")).toBe(false); // … but not escalated
  });

  it("investigation order follows priority classes, ties by id — not the insight ranking", () => {
    const r = buildDecisionInsights(workspace(mixedBasis()));
    const p = r.investigations.map((i) => i.priority);
    expect(p).toEqual([...p].sort((a, b) => a - b));
  });

  it("older evidence is escalated only when material", () => {
    const small = buildDecisionInsights(workspace([equity("A", 1000, 100), equity("OLD", 1, 1, { recency: "STALE" })]));
    expect(small.investigations.some((i) => i.kind === "STALE_EVIDENCE")).toBe(false);
    const big = buildDecisionInsights(workspace([equity("A", 1000, 10), equity("OLD", 1000, 10, { recency: "STALE" })]));
    expect(big.investigations.some((i) => i.kind === "STALE_EVIDENCE")).toBe(true);
  });
});

describe("scenario conclusions with assumptions", () => {
  const positions = mixedBasis();
  const run = (bps = 300) => scenarioFor(positions, [classRule("CORPORATE_BOND", bps), classRule("GOVERNMENT_BOND", bps), classRule("EQUITY", -10)]);

  it("names the Analytical Starting Value and the valuation basis of the start", () => {
    const s = run();
    const i = buildScenarioInsight({ name: "Broad selloff", portfolioId: "pf1", view: s.view, result: s.result });
    expect(i.fact).toMatch(/^Under Broad selloff, Analytical Starting Value (falls|rises) by about/);
    expect(i.basis).toMatchObject({ label: "Analytical Starting Value", analytical: true, assumptionCount: 1, excludedCount: 1 });
    expect(i.basis.line).toMatch(/^\d+% Korbly-supported · \d+% analyst assumptions$/);
    expect(i.quality.statement).toMatch(/rests on analyst assumptions/);
  });

  it("when the main driver starts from an assumption the result says so and raises a priority-2 investigation", () => {
    const heavy = [assumedBond("CORPORATE_BOND", { id: "K", label: "Kasapreko Sep-28", nominal: 5_000_000, maturity: "2030-09-12", assumption: { kind: "YIELD_PCT", value: 28 } }), equity("GCB", 1000, 40)];
    const s = scenarioFor(heavy, [classRule("CORPORATE_BOND", 400)]);
    const i = buildScenarioInsight({ name: "Rate pressure", portfolioId: "pf1", view: s.view, result: s.result });
    expect(i.mainHolding?.basis).toBe("ANALYST_ASSUMPTION");
    expect(i.interpretation).toMatch(/Kasapreko Sep-28 is the largest contributor, and its starting valuation uses an analyst-supplied 28\.00% yield — so this result depends on that assumption/);
    const inv = i.investigations.find((x) => x.kind === "SCENARIO_ASSUMPTION");
    expect(inv?.priority).toBe(INVESTIGATION_PRIORITY.SCENARIO_ASSUMPTION);
    expect(i.investigations[0].kind).toBe("SCENARIO_ASSUMPTION");
  });

  it("several excluded holdings are ONE investigation, so they cannot crowd out the assumption-driver prompt", () => {
    const pos = [assumedBond("CORPORATE_BOND", { id: "K", label: "Kasapreko Sep-28", nominal: 5_000_000, maturity: "2030-09-12", assumption: { kind: "YIELD_PCT", value: 28 } }), corp({ id: "U1", label: "U1", nominal: 1000, maturity: "2029-03-01", ytm: null }), corp({ id: "U2", label: "U2", nominal: 1000, maturity: "2029-03-01", ytm: null }), corp({ id: "U3", label: "U3", nominal: 1000, maturity: "2029-03-01", ytm: null })];
    const s = scenarioFor(pos, [classRule("CORPORATE_BOND", 400)]);
    const i = buildScenarioInsight({ name: "Rate pressure", portfolioId: "pf1", view: s.view, result: s.result });
    expect(i.investigations.filter((x) => x.kind === "SCENARIO_EXCLUDED")).toHaveLength(1);
    expect(i.investigations.find((x) => x.kind === "SCENARIO_EXCLUDED")!.prompt).toMatch(/and 2 other excluded holdings/);
    expect(i.investigations.some((x) => x.kind === "SCENARIO_ASSUMPTION")).toBe(true);
  });

  it("contribution ranking is within the scenario dimension: by absolute impact, deterministic ties", () => {
    const s = run();
    const i = buildScenarioInsight({ name: "x", portfolioId: "pf1", view: s.view, result: s.result });
    const impacts = i.byHolding.map((b) => Math.abs(b.impactGhs));
    expect(impacts).toEqual([...impacts].sort((a, b) => b - a));
    expect(i.byHolding.find((b) => b.basis === "ANALYST_ASSUMPTION")?.assumptionSummary).toBe("28.00% yield");
  });

  it("without assumptions the wording stays Reference Value and the basis line says 100% Korbly-supported", () => {
    const s = scenarioFor(mixed(), [classRule("GOVERNMENT_BOND", 200)]);
    const i = buildScenarioInsight({ name: "x", portfolioId: "pf1", view: s.view, result: s.result });
    expect(i.fact).toMatch(/Reference Value/);
    expect(i.basis).toMatchObject({ analytical: false, line: "100% Korbly-supported" });
  });
});

describe("hero and quality wording", () => {
  it("hero line is count-first and compact; zero counts are omitted", () => {
    const w = workspace(mixedBasis());
    const q = buildQuality(w, buildHoldings(w));
    expect(q.basisLine).toBe("4 valued · 1 not valued");
    expect(q.assumptionLine).toBe("1 analyst assumption");
    expect(q.evidenceLine).toBe("3 recent");
    expect(q.evidenceLine).not.toMatch(/assum/);
    expect(q.basisLine).not.toMatch(/recent|older/);
    const one = buildQuality(workspace([equity("A", 1, 1)]), buildHoldings(workspace([equity("A", 1, 1)])));
    expect({ b: one.basisLine, a: one.assumptionLine, e: one.evidenceLine }).toEqual({ b: "1 valued", a: "", e: "1 recent" });
  });

  it("the quality summary with assumptions separates Korbly-supported from assumed", () => {
    const w = workspace(mixedBasis());
    expect(buildQuality(w, buildHoldings(w)).summary).toBe("3 of 5 holdings are supported by Korbly valuations; 1 rests on analyst assumptions; 1 cannot be valued.");
  });

  it("without assumptions the established sentence is unchanged", () => {
    const w = workspace([equity("A", 1, 1)]);
    expect(buildQuality(w, buildHoldings(w)).summary).toBe("1 of 1 holding uses recent valuation evidence.");
  });
});
