// M9.0.1 — what a user (and a screen reader) gets for each kind of value: the four bases are distinguishable by WORD and MARK,
// not colour alone; the assumption editor discloses and offers only valid choices; terminology follows the basis.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDecisionInsights, buildHoldings, buildMaturityProfile, buildQuality } from "@/lib/decision-insights";
import type { BondTerms } from "@/lib/fixed-income";
import { assumptionAvailability, summarizePortfolio, valueBondPosition, valueBondWithAssumption, valueEquityPosition } from "@/lib/portfolio";
import { BasisBadge, ValuationBasisBar } from "@/components/portfolio/basis";
import { AssumptionEditor } from "@/components/portfolio/AssumptionEditor";
import { ValuationBreakdown } from "@/components/portfolio/ValuationBreakdown";
import { Hero } from "../Hero";
import { HoldingsView } from "../Holdings";
import { Overview } from "../Overview";
import { QualityPanel } from "../Quality";
import { mixedBasis, mixed, workspace, VAL } from "@/lib/decision-insights/__tests__/fixtures";

/** Static markup with React's text-node separators removed, so sentences can be matched as a reader sees them. */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const TERMS: BondTerms = { issueDate: new Date("2024-03-01T00:00:00Z"), maturityDate: new Date("2030-03-01T00:00:00Z"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const noop = async () => ({});

describe("the four kinds of value are told apart by word and mark", () => {
  it("each basis has its own label and its own mark", () => {
    const seen = new Set<string>();
    for (const [basis, word, mark] of [["REFERENCE", "Reference", "●"], ["INDICATIVE", "Indicative", "◐"], ["ANALYST_ASSUMPTION", "Analyst assumption", "◇"], ["UNVALUED", "Unvalued", "○"]] as const) {
      const m = html(createElement(BasisBadge, { basis }));
      expect(m).toContain(word);
      expect(m).toContain(mark);
      seen.add(m);
    }
    expect(seen.size).toBe(4);
  });

  it("an assumption badge states the assumption itself", () => {
    expect(html(createElement(BasisBadge, { basis: "ANALYST_ASSUMPTION", detail: "28.00% yield" }))).toContain("28.00% yield");
  });
});

describe("valuation-basis bar", () => {
  const ws = workspace(mixedBasis());
  const m = html(createElement(ValuationBasisBar, { summary: ws.summary, unvaluedPrincipalGhs: 500_000 }));
  it("is labelled with the exact split and shows amounts and percentages as text", () => {
    expect(m).toMatch(/role="img" aria-label="Valuation basis of GHS [\d,]+: Reference \d+%, Indicative \d+%, Analyst assumptions \d+%"/);
    expect(m).toMatch(/Analyst assumptions<\/span><span[^>]*>\d+%/);
  });
  it("lists unvalued holdings separately and says they are not counted as zero", () => {
    expect(m).toMatch(/1 holding remains unvalued — GHS 500k of principal excluded, not counted as zero/);
  });
  it("hatches the assumption segment so it does not rely on colour", () => expect(m).toContain("basis-hatch"));
  it("shows nothing when nothing is valued", () => {
    expect(html(createElement(ValuationBasisBar, { summary: summarizePortfolio([], VAL) }))).toBe("");
  });
});

describe("hero, holdings and quality with a mixed-basis portfolio", () => {
  const ws = workspace(mixedBasis());
  const holdings = buildHoldings(ws);
  const quality = buildQuality(ws, holdings);
  const hero = html(createElement(Hero, { name: "P", description: null, summary: ws.summary, allocation: ws.exposures.allocation, quality, holdings, valuationDate: "2026-10-05", archived: false, actions: null }));

  it("the headline is the Analytical Starting Value, not a Reference Value, with the split beside it", () => {
    expect(hero).toContain("Analytical Starting Value");
    expect(hero).not.toMatch(/>Reference Value</);
    expect(hero).toMatch(/Korbly-supported/);
    expect(hero).toMatch(/analyst assumptions/);
    expect(hero).toMatch(/not an observed market value, and it is not a Reference value/);
  });
  it("the hero evidence line is compact and count-first", () => {
    expect(hero).toContain("3 recent · 1 assumed · 1 not valued");
    expect(hero).toContain("of 5 holdings");
  });
  it("coverage squares include a labelled assumption state", () => {
    expect(hero).toContain('aria-label="Kasapreko Sep-28: analyst assumption"');
    expect(hero).toContain('aria-label="CALPREF: needs review"');
  });
  it("a reference-only portfolio keeps the Reference Value headline", () => {
    const r = workspace(mixed());
    const m = html(createElement(Hero, { name: "P", description: null, summary: r.summary, allocation: r.exposures.allocation, quality: buildQuality(r, buildHoldings(r)), holdings: buildHoldings(r), valuationDate: "2026-10-05", archived: false, actions: null }));
    expect(m).toContain("Reference Value");
    expect(m).not.toContain("Analytical Starting Value");
  });

  it("holdings show each holding's basis; an assumption shows its assumption; an unvalued one invites (not forces) an assumption", () => {
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens: "SIMPLE", valueLabel: "Analytical Starting Value" }));
    expect(m).toContain("Analytical Starting Value · weight");
    expect(m).toMatch(/Analyst assumption<span[^>]*>· 28\.00% yield/);
    expect(m).toContain("Not observed");
    expect(m).toMatch(/You can keep it unvalued or open it to add an assumption/);
    expect(m).toContain("Reference");
    expect(m).toContain("Indicative");
  });

  it("the data-quality panel separates valuation basis from data quality", () => {
    const m = html(createElement(QualityPanel, { quality, holdings, summary: ws.summary }));
    expect(m).toMatch(/Valuation basis \(what kind of value\) is separate from data quality/);
    expect(m).toContain("Korbly-supported: built from accepted observed market evidence.");
    expect(m).toContain("Assumed by the analyst: not observed, and not a Korbly valuation.");
    expect(m).toContain("of valued Analytical Starting Value");
  });

  it("the overview names its denominators correctly", () => {
    const m = html(createElement(Overview, { portfolioId: "pf1", archived: false, exposures: ws.exposures, holdings, maturity: buildMaturityProfile(ws), insights: buildDecisionInsights(ws), previews: [] }));
    expect(m).toContain("Largest holdings by Analytical Starting Value");
    expect(m).not.toMatch(/(?<!not a )(?<!not )market value/i);
  });
});

describe("assumption editor", () => {
  const subject = { assetClass: "BOND", nominalGhs: 1_000_000, terms: TERMS } as const;
  const unvaluedStanding = { status: "UNVALUED", basisLabel: null, valueGhs: null, reason: "No market observation has been imported for this bond.", availability: assumptionAvailability("BOND", "NO_OBSERVATION") } as const;
  const render = (over: Record<string, unknown> = {}) => html(createElement(AssumptionEditor, { subject, valuationDateIso: "2026-10-05", korbly: unvaluedStanding, stored: null, inForce: false, saveAction: noop, removeAction: async () => {}, archived: false, ...over } as never));

  it("an unvalued, assumable bond: states there is no reliable Reference Value, lets the analyst leave it unvalued, and discloses", () => {
    const m = render();
    expect(m).toContain("No reliable Reference Value");
    expect(m).toMatch(/You can leave it unvalued, or provide a valuation assumption/);
    expect(m).toContain("This is an analyst assumption, not an observed market price.");
  });

  it("offers only what is valid for a bond; par is worded as an assumption, never as the value", () => {
    const m = render();
    expect(m).toContain("Assume a yield");
    expect(m).toContain("Assume a price");
    expect(m).toContain("Use par as an assumption");
    expect(m).not.toContain("Assume a share price");
    expect(m).not.toMatch(/Use par value/i);
    expect(m).toMatch(/not a view that par is today(?:'|&#x27;)s value/);
  });

  it("an equity is offered only a price; a bill a rate or a price (no par)", () => {
    const eq = render({ subject: { assetClass: "EQUITY", shares: 1000 }, korbly: { ...unvaluedStanding, availability: assumptionAvailability("EQUITY", "NO_TRADE") } });
    expect(eq).toContain("Assume a share price");
    expect(eq).not.toContain("Assume a yield");
    const bill = render({ subject: { assetClass: "TREASURY_BILL", faceValueGhs: 1_000_000, daysToMaturity: 182 }, korbly: { ...unvaluedStanding, availability: assumptionAvailability("TREASURY_BILL", "NO_REFERENCE_RATE") } });
    expect(bill).toContain("Assume a rate");
    expect(bill).toContain("Assume a price");
    expect(bill).not.toContain("Use par as an assumption");
  });

  it("missing contract terms: no form at all — the reason is given and nothing is invented", () => {
    const m = render({ korbly: { ...unvaluedStanding, reason: "terms", availability: assumptionAvailability("BOND", "TERMS_UNSUPPORTED") } });
    expect(m).toContain("Cannot be modelled");
    expect(m).toMatch(/does not invent contract terms/);
    expect(m).not.toContain("Save assumption");
  });

  it("a stored assumption in use can be changed or removed; removal says where the holding returns to", () => {
    const m = render({ stored: { kind: "YIELD_PCT", value: 28, overridesReference: false }, inForce: true });
    expect(m).toContain("Starting assumption in use");
    expect(m).toContain("Change the assumption");
    expect(m).toContain("Remove assumption");
    expect(m).toMatch(/unvalued — not counted as zero/);
  });

  it("a stored assumption that yielded to a newer Reference Value is flagged as not in use", () => {
    const m = render({ korbly: { status: "VALUED", basisLabel: "Reference", valueGhs: 1_020_000, reason: null, availability: { assumable: true, kinds: [] } }, stored: { kind: "YIELD_PCT", value: 28, overridesReference: false }, inForce: false });
    expect(m).toContain("Stored assumption (not in use)");
    expect(m).toMatch(/never silently replaces/);
  });

  it("a Korbly-valued holding offers a deliberate override and promises not to change Korbly's value", () => {
    const m = render({ korbly: { status: "VALUED", basisLabel: "Reference", valueGhs: 1_020_000, reason: null, availability: { assumable: true, kinds: [] } } });
    expect(m).toContain("Test a different starting assumption");
    expect(m).toMatch(/without changing it/);
  });

  it("an archived portfolio cannot save", () => {
    expect(render({ archived: true })).toMatch(/<button[^>]*disabled[^>]*>Save assumption/);
  });
});

describe("calculation view", () => {
  it("an assumption value shows the assumption, the disclosure, the arithmetic and never an observation date", () => {
    const m = html(createElement(ValuationBreakdown, { valuation: valueBondWithAssumption(1_000_000, TERMS, { kind: "YIELD_PCT", value: 28, overridesReference: false }, VAL) }));
    expect(m).toContain("28.00% yield");
    expect(m).toContain("This is an analyst assumption, not an observed market price.");
    expect(m).toContain("Assumption value");
    expect(m).toContain("Starting yield");
    expect(m).toMatch(/the yield you assumed/);
    expect(m).not.toContain("Observed on");
    expect(m).toMatch(/neither “recent” nor “stale”/);
  });

  it("an override keeps Korbly's own value visible and states it is unchanged", () => {
    const korbly = valueEquityPosition(100, { available: true, assetClass: "EQUITY", priceGhs: 10, priceDate: "2026-10-03", ageDays: 2, recency: "RECENT", volume: 10, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-03", skippedNoTradeRows: 0 });
    const v = valueBondWithAssumption(1_000_000, TERMS, { kind: "PAR", value: null, overridesReference: true }, VAL);
    if (v.status !== "VALUED" || korbly.status !== "VALUED") throw new Error("valued");
    const m = html(createElement(ValuationBreakdown, { valuation: { ...v, korblyBasis: { basis: "REFERENCE", valueGhs: korbly.referenceValueGhs, inputDate: "2026-10-03", recency: "RECENT" } } }));
    expect(m).toMatch(/Korbly’s own Reference value is GHS 1,000\.00/);
    expect(m).toMatch(/it is unchanged/);
  });

  it("an unvalued position says it is not zero", () => {
    const m = html(createElement(ValuationBreakdown, { valuation: valueBondPosition(1_000_000, TERMS, { available: false, code: "NO_OBSERVATION", reason: "No market observation has been imported for this bond." }, VAL) }));
    expect(m).toMatch(/not treated as zero/);
    expect(m).toContain("Unvalued");
  });
});
