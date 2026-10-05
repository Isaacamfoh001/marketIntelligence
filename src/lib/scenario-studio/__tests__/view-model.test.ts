import { describe, expect, it } from "vitest";
import { buildStudioView, type StudioView } from "../view-model";
import { buildComparison } from "../compare";
import { calpref, eqClass, eqIn, gcb, govClass, govLong, govLongSecurity, govShort, corpClass, kasa, kasaBondIssuer, linksFor, MIXED, run } from "./fixtures";
import { formatIsoDate } from "../../fixed-income";
import { valueEquityPosition } from "../../portfolio";

const view = (positions = MIXED(), rules = [govClass(200), corpClass(300), eqClass(-10)]): { v: StudioView; r: ReturnType<typeof run> } => {
  const r = run(positions, rules);
  return { v: buildStudioView({ result: r, links: linksFor(r), provenance: {} }), r };
};

const allText = (v: StudioView): string => [v.headline.sentence, ...v.assumptions.flatMap((a) => [a.plain, a.replacesNote ?? "", a.noEffectNote ?? ""]), ...v.meaning, ...v.investigations.flatMap((i) => [i.title, i.headline, i.why]), ...v.confidence.flags.map((f) => f.message), ...v.positions.flatMap((p) => [p.assumptionPlain, ...p.simple, p.freshnessNote ?? ""])].join("\n");

describe("headline (broad selloff on a mixed portfolio)", () => {
  const { v, r } = view();
  it("carries the engine's numbers exactly", () => {
    const p = r.portfolio;
    expect(v.headline.status).toBe("RESULT");
    expect(v.headline.startingValueGhs).toBe(p.referenceBasisGhs);
    expect(v.headline.scenarioValueGhs).toBe(p.scenarioValueGhs);
    expect(v.headline.impactGhs).toBe(p.impactGhs);
    expect(v.headline.impactPct).toBe(p.impactPct);
    expect(v.headline.direction).toBe("FALL");
    expect(v.headline.sentence).toMatch(/^Under these assumptions, the valued portfolio falls by \d+\.\d{2}% \(about GHS [\d,]+\)\.$/);
  });
  it("shows the starting value in plain terms and the change with a sign", () => {
    expect(v.headline.impactWhole).toMatch(/^−GHS [\d,]+$/);
    expect(v.headline.impactPctText).toMatch(/^−\d+\.\d{2}%$/);
    expect(v.headline.startingCompact).toMatch(/^GHS [\d.]+[mk]$/);
  });
});

describe("drivers", () => {
  const { v, r } = view();
  it("class impacts and shares come from the engine and add to 100% of the decline", () => {
    for (const c of v.byClass) expect(c.impactGhs).toBe(r.portfolio.byAssetClass.find((x) => x.assetClass === c.assetClass)!.impactGhs);
    const shares = v.byClass.map((c) => c.sharePct ?? 0).reduce((a, b) => a + b, 0);
    expect(shares).toBeCloseTo(100, 9);
  });
  it("selects the largest class and the largest position in the direction of the move", () => {
    const biggest = [...r.portfolio.byAssetClass].sort((a, b) => a.impactGhs - b.impactGhs)[0];
    expect(v.mainClass?.assetClass).toBe(biggest.assetClass);
    expect(v.topPositions[0].positionId).toBe(r.portfolio.largestNegative[0].positionId);
    expect(v.topPositions.map((p) => p.impactGhs)).toEqual([...v.topPositions.map((p) => p.impactGhs)].sort((a, b) => a - b));
  });
});

describe("confidence", () => {
  it("states coverage, stale share and exclusions near the headline", () => {
    const { v, r } = view();
    expect(v.confidence.coverageLine).toBe("5 of 6 positions included");
    expect(v.confidence.excludedLine).toMatch(/^1 position excluded/);
    expect(v.confidence.staleBasisPct).toBe(r.portfolio.staleBasisPct);
    expect(v.confidence.staleLine).toBe(`${r.portfolio.staleBasisPct!.toFixed(1)}% of the scenario basis uses stale reference observations`);
    expect(v.confidence.flags.map((f) => f.code)).toEqual(["INCOMPLETE", "STALE_DEPENDENCE"]);
    expect(v.confidence.valuedLine).toMatch(/valued$/);
  });
  it("recent inputs when nothing is stale or excluded", () => {
    const { v } = view([govLong(), gcb()], [govClass(100)]);
    expect(v.confidence.primary).toBe("RECENT_INPUTS");
    expect(v.confidence.flags[0].message).toBe("All reference inputs behind this result are recent.");
    expect(v.confidence.staleLine).toBeNull();
  });
  it("a repricing error is reported as such, in plain words", () => {
    // A valued bond whose contractual terms are unavailable to the scenario cannot be repriced.
    const fragile = { ...govShort(), positionId: "p-frag", label: "Fragile", terms: null };
    const { v, r } = view([govLong(), fragile], [govClass(200)]);
    expect(r.portfolio.scenarioErrorCount).toBeGreaterThan(0);
    expect(v.confidence.flags[0].code).toBe("REPRICING_ERROR");
    expect(v.confidence.flags[0].message).toMatch(/could not be repriced under these assumptions/);
    expect(v.confidence.flags[0].message).not.toMatch(/INVALID_YIELD_DOMAIN|PRICING_FAILED/);
  });
});

describe("what this means", () => {
  const { v } = view();
  it("states the headline and the main driver in plain English", () => {
    expect(v.meaning[0]).toBe(v.headline.sentence);
    expect(v.meaning.some((m) => /account for (more than half of|[\d.]+%)|are the largest source/.test(m) || /more than half/.test(m))).toBe(true);
    expect(v.meaning.some((m) => /is the largest individual contributor to the decline\.$/.test(m))).toBe(true);
  });
  it("communicates stale share and the excluded holding", () => {
    expect(v.meaning.some((m) => /^About \d+% of the scenario basis relies on stale market observations/.test(m))).toBe(true);
    expect(v.meaning).toContain("One holding is excluded because Korbly does not have a sufficiently reliable reference value.");
  });
  it("never recommends, forecasts or calls anything dangerous", () => {
    const text = allText(v);
    expect(text).not.toMatch(/\b(buy|sell|hold|should|recommend|reduce your|dangerous|unattractive|likely|unlikely|expected|probable|bullish|bearish|forecast|predict)\b/i);
    expect(text).not.toMatch(/market value/i);
  });
});

describe("investigation cards", () => {
  const { v, r } = view();
  it("are deterministic and short", () => {
    expect(v.investigations.length).toBeLessThanOrEqual(5);
    const again = view().v.investigations;
    expect(again).toEqual(v.investigations);
  });
  it("lists the largest driver first with its impact and a link", () => {
    const first = v.investigations[0];
    expect(first.kind).toBe("LARGEST_DRIVER");
    expect(first.positionId).toBe(r.portfolio.largestNegative[0].positionId);
    expect(first.link?.href).toContain(first.positionId);
  });
  it("flags the stale Kasapreko bond with the evidence link and the unvalued holding with an inspect link", () => {
    const stale = v.investigations.find((i) => i.kind === "STALE_INPUT");
    expect(stale?.positionLabel).toBe("Kasapreko Sep-28");
    expect(stale?.link?.href).toBe("/evidence/p-corp");
    const missing = v.investigations.find((i) => i.kind === "MISSING_VALUATION");
    expect(missing?.positionLabel).toBe("CALPREF");
    expect(missing?.headline).toBe("Korbly excluded this holding because there is no sufficiently reliable current reference value.");
    expect(missing?.link?.href).toBe("/inspect/p-calpref");
  });
  it("a stale holding that is already a card gets the staleness added to it, not a duplicate card", () => {
    const staleGcb = { ...gcb(), valuation: valueEquityPosition(500_000, eqIn(4.5, { recency: "STALE", ageDays: 42, priceDate: "2026-08-24" })) };
    const { v: sv } = view([govLong(), staleGcb], [govClass(200), eqClass(-10)]);
    const cards = sv.investigations.filter((i) => i.positionLabel === "GCB");
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe("LARGEST_DRIVER");
    expect(cards[0].why).toMatch(/Its reference observation is stale \(24 Aug 2026, 42 days old\)\.$/);
  });
  it("only creates cards that are factually justified", () => {
    const { v: clean } = view([govLong(), gcb()], [govClass(100)]);
    expect(clean.investigations.map((i) => i.kind)).toEqual(["LARGEST_DRIVER"]); // no stale, no unvalued, no second bond
  });
  it("does not manufacture insight when nothing moves", () => {
    const { v: flat } = view([govLong(), gcb()], [govClass(0), eqClass(0)]);
    expect(flat.investigations).toEqual([]);
  });
});

describe("security-specific assumption over a broad one", () => {
  const { v } = view([govLong(), govShort()], [govClass(200), govLongSecurity(400)]);
  it("explains the override in plain English without needing precedence jargon", () => {
    expect(v.meaning).toContain("GoG Jul-34 is stressed more heavily than the broader Government bonds assumption because this scenario contains a security-specific assumption for it.");
  });
  it("notes on the assumption that it replaces, not adds to, the broader one", () => {
    const a = v.assumptions.find((x) => x.id === "sec-govlong")!;
    expect(a.replacesNote).toMatch(/replaces the broader Government bonds \(\+200 bps\) assumption .* does not add to it/);
    expect(a.appliesTo).toBe(1);
    const broad = v.assumptions.find((x) => x.id === "gov")!;
    expect(broad.appliesTo).toBe(1); // only GoG Jan-28 still uses it
  });
  it("shows the winning rule inside the technical details", () => {
    const p = v.positions.find((x) => x.positionId === "p-govlong")!;
    const rows = p.technical.flatMap((g) => g.rows);
    expect(rows.find((x) => x.label === "Winning rule")?.value).toBe("Security: GoG Jul-34 +400 bps");
    expect(rows.find((x) => x.label === "Also matched (overridden)")?.value).toBe("Government bonds +200 bps");
  });
});

describe("issuer concern: Kasapreko bonds only", () => {
  const { v, r } = view(MIXED(), [kasaBondIssuer(500)]);
  it("changes the Kasapreko bond and leaves KASA equity unchanged, and says why", () => {
    const bond = r.positions.find((p) => p.positionId === "p-corp")!;
    const eq = r.positions.find((p) => p.positionId === "p-kasa")!;
    expect(bond.status === "PARTICIPATING" && bond.outcome).toBe("SHOCKED");
    expect(eq.status === "PARTICIPATING" && eq.outcome).toBe("UNCHANGED");
    expect(v.meaning.some((m) => /^KASA is unchanged: the Kasapreko Company PLC assumption applies to its bonds only, not to its shares\./.test(m))).toBe(true);
    const kasaView = v.positions.find((p) => p.positionId === "p-kasa")!;
    expect(kasaView.assumptionPlain).toBe("The Kasapreko Company PLC assumption does not reach this holding");
    expect(kasaView.impactGhs).toBe(0);
  });
  it("portfolio impact equals the Kasapreko bond's impact", () => {
    const bond = v.positions.find((p) => p.positionId === "p-corp")!;
    expect(v.headline.impactGhs).toBe(bond.impactGhs);
  });
});

describe("edge states", () => {
  it("empty portfolio", () => {
    const { v } = view([], [govClass(200)]);
    expect(v.headline.status).toBe("NO_POSITIONS");
    expect(v.headline.impactGhs).toBeNull();
    expect(v.positions).toEqual([]);
    expect(v.investigations).toEqual([]);
  });
  it("all holdings unvalued: no number is invented", () => {
    const { v } = view([calpref(), { ...kasa(), valuation: { ...kasa().valuation, status: "UNVALUED", assetClass: "EQUITY", available: false, code: "NO_PRICE", reason: "No price." } as never }], [eqClass(-10)]);
    expect(v.headline.status).toBe("NO_VALUED_POSITIONS");
    expect(v.headline.impactGhs).toBeNull();
    expect(v.headline.sentence).toMatch(/excludes holdings it cannot value rather than estimating them/);
    expect(v.investigations.every((i) => i.kind === "MISSING_VALUATION")).toBe(true);
    expect(v.confidence.coverageLine).toBe("0 of 2 positions included");
  });
  it("no assumptions: every holding keeps its starting value", () => {
    const { v } = view(MIXED(), []);
    expect(v.headline.direction).toBe("UNCHANGED");
    expect(v.headline.impactGhs).toBe(0);
    expect(v.meaning[0]).toMatch(/no assumptions yet/);
    expect(v.investigations.map((i) => i.kind)).toEqual(["MISSING_VALUATION"]);
  });
  it("assumptions that reach nothing are called out", () => {
    const { v } = view([gcb()], [govClass(200)]);
    expect(v.headline.direction).toBe("UNCHANGED");
    expect(v.assumptions[0].noEffectNote).toBe("No holding in this portfolio is reached by this assumption.");
    expect(v.meaning).toContain("None of the holdings is reached by these assumptions.");
  });
  it("positive scenario uses rise/increase language", () => {
    const { v } = view(MIXED(), [govClass(-200), eqClass(10)]);
    expect(v.headline.direction).toBe("RISE");
    expect(v.headline.sentence).toMatch(/rises by/);
    expect(v.meaning.some((m) => /of the increase|the largest individual contributor to the increase/.test(m))).toBe(true);
    expect(allText(v)).not.toMatch(/decline/);
  });
  it("mixed contributors: names the offset and keeps shares ≤ 100%", () => {
    const { v } = view(MIXED(), [govClass(200), eqClass(2)]);
    expect(v.headline.direction).toBe("FALL");
    expect(v.meaning.some((m) => /move the other way, offsetting GHS/.test(m) || /moves the other way, offsetting GHS/.test(m))).toBe(true);
    for (const c of v.byClass) expect(c.sharePct === null || (c.sharePct >= 0 && c.sharePct <= 100)).toBe(true);
    expect(v.byClass.find((c) => c.assetClass === "EQUITY")!.sharePct).toBeNull(); // rose, so not a share of the decline
  });
});

describe("position explanations", () => {
  const { v, r } = view([govLong(), gcb(), calpref()], [govClass(200), eqClass(-10)]);
  it("bond: simple explanation first, in plain words", () => {
    const p = v.positions.find((x) => x.positionId === "p-govlong")!;
    expect(p.simple[0]).toMatch(/^Under this scenario, its assumed yield rises from 28\.01% to 30\.01%\. Because bond prices move in the opposite direction to yields, its value falls from GHS [\d.]+[mk] to GHS [\d.]+[mk]\. That reduces the portfolio by approximately GHS [\d.]+[mk]\.$/);
    expect(p.simple[0]).not.toMatch(/DV01|dirty|accrued|duration|convexity/i);
    expect(p.assumptionPlain).toBe("Government bond yields rise by 2.0 percentage points");
  });
  it("bond: technical rows match the M8.3 detail exactly", () => {
    const eng = r.positions.find((x) => x.positionId === "p-govlong")!;
    if (eng.status !== "PARTICIPATING" || eng.detail.assetClass !== "BOND") throw new Error("expected bond");
    const d = eng.detail;
    const rows = Object.fromEntries(v.positions.find((x) => x.positionId === "p-govlong")!.technical.flatMap((g) => g.rows).map((x) => [x.label, x.value]));
    expect(rows["Reference yield"]).toBe(`${d.referenceYieldPct.toFixed(4)}%`);
    expect(rows["Scenario yield"]).toBe(`${d.scenarioYieldPct.toFixed(4)}%`);
    expect(rows["Applied assumption"]).toBe("+200 bps");
    expect(Number(rows["Reference dirty price"].replace(/,/g, ""))).toBeCloseTo(d.referenceDirtyPrice, 6);
    expect(Number(rows["Scenario dirty price"].replace(/,/g, ""))).toBeCloseTo(d.scenarioDirtyPrice, 6);
    expect(Number(rows["Accrued interest"])).toBeCloseTo(d.accruedInterest, 6);
    expect(rows["Reference value"]).toBe(`GHS ${eng.referenceValueGhs.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
    expect(rows["Exact impact"]).toBe(`−GHS ${Math.abs(eng.impactGhs).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`);
    const g2 = (n: number) => Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(rows["DV01"]).toBe(`GHS ${g2(d.dv01Ghs!)}/bp`);
    expect(rows["First-order DV01 estimate"]).toBe(`−GHS ${g2(d.firstOrderImpactGhs!)}`);
    expect(rows["Exact repricing difference"]).toBe(`${d.firstOrderErrorGhs! > 0 ? "+" : "−"}GHS ${g2(d.firstOrderErrorGhs!)}`);
  });
  it("bond: glosses DV01 and dirty price in plain language", () => {
    const notes = v.positions.find((x) => x.positionId === "p-govlong")!.technical.flatMap((g) => g.rows).map((x) => x.note ?? "").join(" ");
    expect(notes).toMatch(/Exact cash-flow repricing is used for the scenario result; DV01 is shown only as an approximation of small rate changes\./);
    expect(notes).toMatch(/Dirty price includes accrued interest/);
    expect(notes).toMatch(/For a very small increase in yields, this position changes by roughly/);
  });
  it("equity: plain explanation and technical rows", () => {
    const p = v.positions.find((x) => x.positionId === "p-gcb")!;
    expect(p.simple[0]).toMatch(/^Under this scenario, its share price falls 10%, from GHS 4\.50 to GHS 4\.05\./);
    const rows = Object.fromEntries(p.technical.flatMap((g) => g.rows).map((x) => [x.label, x.value]));
    expect(rows["Applied assumption"]).toBe("−10%");
    expect(rows["Shares"]).toBe("500,000");
  });
  it("unvalued holding: explained as excluded, not estimated", () => {
    const p = v.positions.find((x) => x.positionId === "p-calpref")!;
    expect(p.status).toBe("UNAVAILABLE");
    expect(p.simple).toEqual(["We do not have a sufficiently reliable reference value for this holding, so it is excluded rather than estimated."]);
    expect(p.impactGhs).toBeNull(); // missing is not zero
  });
  it("stale holding gets the plain freshness sentence", () => {
    const { v: sv } = view(MIXED(), [corpClass(300)]);
    const p = sv.positions.find((x) => x.positionId === "p-corp")!;
    expect(p.freshnessNote).toBe("The latest reliable market observation for this holding is older than our freshness threshold.");
    const rows = Object.fromEntries(p.technical.flatMap((g) => g.rows).map((x) => [x.label, x.value]));
    expect(rows["Recent or stale"]).toBe("Stale");
    expect(rows["Observation date"]).toBe(formatIsoDate("2026-09-15"));
    expect(rows["Age at valuation date"]).toBe("20 days old");
  });
  it("unchanged holding keeps its starting value and says so", () => {
    const { v: uv } = view([govLong(), gcb()], [govClass(200)]);
    const p = uv.positions.find((x) => x.positionId === "p-gcb")!;
    expect(p.outcome).toBe("UNCHANGED");
    expect(p.simple[0]).toMatch(/^No assumption reaches this holding, so it keeps its starting value/);
    expect(p.impactGhs).toBe(0);
  });
  it("provenance appears in the technical details when supplied", () => {
    const r2 = run([govLong()], [govClass(200)]);
    const v2 = buildStudioView({ result: r2, links: linksFor(r2), provenance: { "p-govlong": { sourceName: "Bank of Ghana GFIM", ingestionRunId: "run-1", retrievedAt: "2026-10-02T09:00:00.000Z", facts: [{ label: "Trade status", value: "Traded" }] } } });
    const g = v2.positions[0].technical.find((x) => x.title === "Source and provenance")!;
    expect(g.rows.map((x) => x.value)).toContain("Bank of Ghana GFIM");
    expect(g.rows.map((x) => x.value)).toContain("run-1");
  });
});

describe("comparison", () => {
  const mild = run(MIXED(), [govClass(100), corpClass(150), eqClass(0)]);
  const severe = run(MIXED(), [govClass(300), corpClass(500), eqClass(-15)]);
  const c = buildComparison([
    { id: "a", name: "Mild rate pressure", result: mild },
    { id: "b", name: "Broad selloff", result: severe },
  ]);
  it("uses a common starting basis and says so", () => {
    expect(c.commonBasis).toBe(true);
    expect(c.basisNote).toBe("Compared using the same current reference inputs.");
    expect(c.startingValueGhs).toBe(mild.portfolio.referenceBasisGhs);
    expect(c.columns[0].startingValueGhs).toBe(c.columns[1].startingValueGhs);
  });
  it("carries each scenario's engine numbers unchanged", () => {
    expect(c.columns[0].impactGhs).toBe(mild.portfolio.impactGhs);
    expect(c.columns[1].impactGhs).toBe(severe.portfolio.impactGhs);
    expect(c.columns[1].scenarioValueGhs).toBe(severe.portfolio.scenarioValueGhs);
    expect(c.columns[0].classAssumptions).toEqual({ TREASURY_BILL: null, GOVERNMENT_BOND: "+100 bps", CORPORATE_BOND: "+150 bps", EQUITY: "0%" });
    expect(c.columns[1].classAssumptions.EQUITY).toBe("−15%");
  });
  it("ranks the view with the larger decline first and explains why", () => {
    expect(c.columns.find((x) => x.id === "b")!.rank).toBe(1);
    expect(c.summary[0]).toMatch(/^"Broad selloff" has the larger effect on the valued portfolio: /);
    expect(c.summary[1]).toMatch(/^Most of that difference comes from /);
  });
  it("reports stale dependence identically because the inputs are the same", () => {
    expect(c.columns[0].staleBasisPct).toBe(c.columns[1].staleBasisPct);
    expect(c.columns.every((x) => x.excludedCount === 1)).toBe(true);
  });
  it("warns instead of comparing cleanly when the basis differs", () => {
    const other = run([govLong()], [govClass(100)]);
    const bad = buildComparison([
      { id: "a", name: "A", result: mild },
      { id: "b", name: "B", result: other },
    ]);
    expect(bad.commonBasis).toBe(false);
    expect(bad.basisNote).toMatch(/do not share an identical starting basis/);
  });
  it("identical views are reported as identical", () => {
    const same = buildComparison([
      { id: "a", name: "A", result: mild },
      { id: "b", name: "B", result: mild },
    ]);
    expect(same.summary[0]).toBe("These views have the same scenario impact on the valued portfolio.");
  });
  it("uses no recommendation language", () => {
    expect(c.summary.join(" ")).not.toMatch(/\b(buy|sell|should|recommend|dangerous|likely|expected|forecast)\b/i);
  });
});
