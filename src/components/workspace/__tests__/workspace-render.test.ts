// Renders the hook-free workspace components to static HTML and checks what a user (and a screen reader) would get:
// labelled controls, text alongside every colour, stable order, no duplicate ids, and the plain-language contract.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDecisionInsights, buildHoldings, buildMaturityProfile, buildQuality, buildScenarioInsight } from "@/lib/decision-insights";
import type { TemplatePreview } from "@/lib/queries/workspace";
import { Hero } from "../Hero";
import { HoldingsView, LENSES } from "../Holdings";
import { Overview } from "../Overview";
import { QualityPanel } from "../Quality";
import { WorkspaceTabs, VIEWS, parseView } from "../Tabs";
import { ContributionChart, Donut } from "../charts";
import { PrimaryConclusionCard, KeyInsights, InvestigationList } from "../Insights";
import { bill, equity, gov, mixed, scenarioFor, templateRules, workspace } from "@/lib/decision-insights/__tests__/fixtures";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const ws = workspace(mixed());
const holdings = buildHoldings(ws);
const quality = buildQuality(ws, holdings);
const insights = buildDecisionInsights(ws);
const previews: TemplatePreview[] = [{ id: "rate-pressure", name: "Rate pressure", blurb: "", assumptionSummary: "Government bonds +200 bps", impactText: "−GHS 94,000", impactPctText: "−0.93%", impactGhs: -94_000 }];
const idsOf = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

describe("overview", () => {
  const markup = html(createElement(Overview, { portfolioId: "pf1", archived: false, exposures: ws.exposures, holdings, maturity: buildMaturityProfile(ws), insights, previews }));
  it("leads with what matters and ends with what to investigate", () => {
    expect(markup.indexOf("What matters")).toBeGreaterThan(-1);
    expect(markup.indexOf("What matters")).toBeLessThan(markup.indexOf("Portfolio at a glance"));
    expect(markup.indexOf("Portfolio at a glance")).toBeLessThan(markup.indexOf("What could move it"));
    expect(markup.indexOf("What could move it")).toBeLessThan(markup.indexOf("Worth investigating"));
  });
  it("every chart states the question it answers", () => {
    for (const q of ["What is this portfolio made of?", "Whose credit does the portfolio ultimately depend on?", "When does capital come due?", "Where does a change in interest rates hit hardest?"]) expect(markup).toContain(q);
  });
  it("charts are labelled and carry their figures as text", () => {
    expect(markup).toMatch(/aria-label="Asset mix: /);
    expect(markup).toMatch(/aria-label="Issuer exposure, largest first"/);
    expect(markup).toMatch(/aria-label="Principal by time to maturity"/);
    expect(markup).toContain("Equities");
    expect(markup).toMatch(/\d+% /);
  });
  it("stress previews show their assumptions beside the result and say they are hypothetical", () => {
    expect(markup).toContain("Government bonds +200 bps");
    expect(markup).toMatch(/not a forecast/i);
  });
  it("speaks of Reference Value and only ever mentions 'market value' to say it is not one", () => {
    expect(markup).toContain("Reference Value");
    expect(markup).not.toMatch(/(?<!not a )(?<!not )market value/i);
  });
  it("has no duplicate element ids", () => {
    const ids = idsOf(markup);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("navigation and perspectives", () => {
  it("five perspectives, each with a distinct question, in a stable order", () => {
    expect(VIEWS.map((v) => v.id)).toEqual(["overview", "holdings", "exposure", "scenarios", "insights"]);
    expect(new Set(VIEWS.map((v) => v.question)).size).toBe(5);
  });
  it("navigation is a labelled landmark of links and marks the current page", () => {
    const m = html(createElement(WorkspaceTabs, { portfolioId: "pf1", current: "scenarios" }));
    expect(m).toContain('aria-label="Portfolio perspectives"');
    expect(m).toMatch(/href="\/portfolios\/pf1\?view=scenarios"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/portfolios\/pf1\?view=scenarios"/);
    expect((m.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });
  it("old ?position= links still open the holdings perspective", () => {
    expect(parseView(undefined, true)).toBe("holdings");
    expect(parseView(undefined, false)).toBe("overview");
    expect(parseView("nonsense", false)).toBe("overview");
  });
});

describe("holdings perspectives", () => {
  it.each(LENSES.map((l) => l.id))("%s lens renders every holding once per layout, labelled", (lens) => {
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens }));
    expect(m).toContain('aria-label="Holdings perspective"');
    expect(m).toMatch(/<caption class="sr-only">Holdings — /);
    for (const h of holdings) expect((m.match(new RegExp(`>${h.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</a>`, "g")) ?? []).length).toBe(2); // table + card layout
  });
  it("Simple lens leads with value, weight, maturity and status — no DV01 or duration by default", () => {
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens: "SIMPLE" }));
    expect(m).toContain("Reference Value · weight");
    expect(m).not.toMatch(/DV01|duration/i);
  });
  it("Rates lens speaks plainly first and keeps DV01 behind a disclosure", () => {
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens: "RATES" }));
    expect(m).toMatch(/per 1 percentage point/);
    expect(m).toMatch(/<details[^>]*>\s*<summary[^>]*>Technical<\/summary>/);
    expect(m).toMatch(/DV01 GHS/);
    expect(m).toContain("Not rate-sensitive");
  });
  it("status is always text, never colour alone", () => {
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens: "SIMPLE" }));
    expect(m).toContain("Recent");
    expect(m).toContain("Older evidence");
  });
  it("an unvalued holding reads 'Needs review' and 'Not valued', not 0", () => {
    const u = buildHoldings(workspace([gov({ id: "U", label: "GoG U", nominal: 1000, maturity: "2031-01-01", ytm: null })]));
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings: u, lens: "SIMPLE" }));
    expect(m).toContain("Needs review");
    expect(m).toContain("Not valued");
    expect(m).not.toMatch(/GHS 0\b/);
  });
  it("order is stable across renders and independent of input order", () => {
    const a = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens: "SIMPLE" }));
    const b = html(createElement(HoldingsView, { portfolioId: "pf1", holdings: buildHoldings(workspace([...mixed()].reverse())), lens: "SIMPLE" }));
    expect(b).toBe(a);
  });
  it("the selected holding is marked", () => {
    const m = html(createElement(HoldingsView, { portfolioId: "pf1", holdings, lens: "SIMPLE", selectedId: "GCB" }));
    expect(m).toContain('aria-current="true"');
  });
});

describe("hero", () => {
  const render = (over = {}) => html(createElement(Hero, { name: "P", description: null, summary: ws.summary, allocation: ws.exposures.allocation, quality, holdings, valuationDate: "2026-10-05", archived: false, actions: null, ...over }));
  it("shows Reference Value, holdings count and evidence status, and no return/P&L", () => {
    const m = render();
    expect(m).toContain("Reference Value");
    expect(m).toMatch(/7<\/span> holdings/);
    expect(m).toContain("holdings use recent valuation evidence");
    expect(m).not.toMatch(/profit|P&amp;L|annuali[sz]ed|income earned/i);
    expect(m).toMatch(/not a market value, and not a return/);
  });
  it("coverage squares are labelled per holding with a text state", () => {
    const m = render();
    expect(m).toContain('aria-label="ALW: older evidence"');
    expect(m).toContain('aria-label="GCB: recent evidence"');
  });
  it("asset mix bar has a text alternative", () => expect(render()).toMatch(/aria-label="Asset mix: .*Equities \d+%/));
  it("an empty portfolio says so instead of showing 0", () => {
    const e = workspace([]);
    const m = render({ summary: e.summary, allocation: e.exposures.allocation, quality: buildQuality(e, []), holdings: [] });
    expect(m).toContain("No holdings yet");
    expect(m).not.toContain("GHS 0");
  });
});

describe("insights and quality presentation", () => {
  it("keeps fact, meaning and review separate and offers the evidence", () => {
    const m = html(createElement(KeyInsights, { insights: insights.insights, investigations: insights.investigations }));
    expect(m).toContain("What it means:");
    expect(m).toContain("Show the evidence");
    const p = html(createElement(PrimaryConclusionCard, { conclusion: insights.primary }));
    expect(p).toContain(insights.primary!.fact);
  });
  it("investigations are numbered, reasoned and link to the holding", () => {
    const m = html(createElement(InvestigationList, { items: insights.investigations }));
    expect(m).toMatch(/Why: /);
    expect(m).toMatch(/href="\/portfolios\/pf1/);
  });
  it("empty investigation list is a calm sentence", () => expect(html(createElement(InvestigationList, { items: [] }))).toContain("Nothing stands out"));
  it("quality panel gives counts, calm language and the bill disclosure", () => {
    const m = html(createElement(QualityPanel, { quality, holdings }));
    expect(m).toContain("Older evidence");
    expect(m).toContain("Needs review");
    expect(m).toMatch(/indicative valuation using an interpolated Bank of Ghana auction rate/i);
    expect(m).not.toMatch(/confidence score/i);
  });
});

describe("contribution chart", () => {
  const s = scenarioFor(mixed(), templateRules("broad-selloff"), "Broad selloff");
  const i = buildScenarioInsight({ name: "Broad selloff", portfolioId: "pf1", view: s.view, result: s.result });
  const m = html(createElement(ContributionChart, { rows: i.byHolding, other: i.otherHoldings, ariaLabel: "Scenario impact by holding" }));
  it("prints the signed amount for every bar (sign is never colour alone)", () => {
    for (const b of i.byHolding) expect(m).toContain(b.impactText);
    expect(m).toMatch(/−GHS/);
  });
  it("is labelled, and bars are decorative (aria-hidden)", () => {
    expect(m).toContain('aria-label="Scenario impact by holding"');
    expect(m).toMatch(/aria-hidden="true"/);
  });
  it("links each holding bar to its inspector", () => expect(m).toMatch(/href="\?view=holdings&amp;position=/));
});

describe("donut", () => {
  it("has a text alternative and a legend with every figure", () => {
    const m = html(createElement(Donut, { slices: [{ key: "a", label: "Equities", pct: 66, valueText: "GHS 6.6m", color: "red" }, { key: "b", label: "Bills", pct: 34, valueText: "GHS 3.4m", color: "blue" }], centerLabel: "Valued", centerValue: "GHS 10m" }));
    expect(m).toContain('aria-label="Asset mix: Equities 66%, Bills 34%"');
    expect(m).toContain("66%");
  });
});

describe("single-asset edge cases", () => {
  it("equity-only portfolio renders overview without bond/bill charts or errors", () => {
    const w = workspace([equity("GCB", 1000, 40)]);
    const m = html(createElement(Overview, { portfolioId: "pf1", archived: false, exposures: w.exposures, holdings: buildHoldings(w), maturity: buildMaturityProfile(w), insights: buildDecisionInsights(w), previews: [] }));
    expect(m).not.toContain("Maturity profile");
    expect(m).not.toContain("Rate sensitivity");
    expect(m).toContain("Asset mix");
  });
  it("bill-only portfolio shows maturity and rate sensitivity", () => {
    const w = workspace([bill("B", 1_000_000, "2027-06-07", 364)]);
    const m = html(createElement(Overview, { portfolioId: "pf1", archived: false, exposures: w.exposures, holdings: buildHoldings(w), maturity: buildMaturityProfile(w), insights: buildDecisionInsights(w), previews: [] }));
    expect(m).toContain("Maturity profile");
    expect(m).toContain("Rate sensitivity");
  });
});
