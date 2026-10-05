// M9.0.1 — Scenario Studio with assumption-valued holdings: basis disclosure, starting-assumption vs shock, comparison on a common basis.
import { describe, expect, it } from "vitest";
import { valueBondWithAssumption, valueEquityWithAssumption, valueBondPosition } from "../../portfolio";
import type { BondTerms } from "../../fixed-income";
import type { ScenarioPosition } from "../../scenarios";
import { buildComparison } from "../compare";
import { buildStudioView } from "../view-model";
import { corpClass, eqClass, govClass, govLong, govShort, kasa, gcb, KASA, run, UNV, VAL, linksFor } from "./fixtures";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const CORP: BondTerms = { issueDate: d("2025-09-01"), maturityDate: d("2028-09-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };

/** Kasapreko bond with no reliable Reference value, carried at an analyst-assumed starting yield. */
const kasaBond = (yieldPct: number): ScenarioPosition => ({ positionId: "p-kbond", label: "Kasapreko Sep-28", assetClass: "CORPORATE_BOND", issuer: KASA, instrumentId: "b-kbond", valuation: valueBondWithAssumption(1_500_000, CORP, { kind: "YIELD_PCT", value: yieldPct, overridesReference: false }, VAL), terms: CORP });
const book = (yieldPct = 28): ScenarioPosition[] => [govLong(), govShort(), kasaBond(yieldPct), gcb()];
const view = (positions: ScenarioPosition[], rules = [corpClass(300), govClass(200), eqClass(-10)]) => {
  const result = run(positions, rules);
  return { result, view: buildStudioView({ result, links: linksFor(result), provenance: {} }) };
};

describe("studio view of a mixed-basis scenario", () => {
  const v = view(book());
  it("labels the starting value as the Analytical Starting Value and splits it by basis", () => {
    expect(v.view.headline.startingLabel).toBe("Analytical Starting Value");
    expect(v.view.headline.analytical).toBe(true);
    const b = v.view.headline.basis!;
    expect(b.assumptionCount).toBe(1);
    expect(b.supportedPct + b.assumptionPct).toBeCloseTo(100, 9);
    expect(Math.round((b.supportedGhs + b.assumptionGhs) * 100)).toBe(Math.round(v.view.headline.startingValueGhs! * 100));
  });

  it("raises an assumption-dependence flag and says changing a starting assumption changes the result", () => {
    const flag = v.view.confidence.flags.find((f) => f.code === "ASSUMPTION_DEPENDENCE");
    expect(flag?.message).toMatch(/rests on analyst assumptions.*Changing a starting assumption changes this result/);
    expect(v.view.meaning.join(" ")).toMatch(/depends on both the starting assumption and the scenario assumption/);
  });

  it("the assumed holding's drill-down shows the assumption, labels the start as an assumption and gives no observation date", () => {
    const p = v.view.positions.find((x) => x.positionId === "p-kbond")!;
    expect(p.basis).toBe("ANALYST_ASSUMPTION");
    expect(p.startingAssumption).toBe("28.00% yield");
    expect(p.recency).toBeNull();
    const rows = p.technical.flatMap((g) => g.rows.map((r) => `${g.title}|${r.label}|${r.value}`));
    expect(rows.some((r) => r.startsWith("Valuation basis|Basis|Analyst assumption"))).toBe(true);
    expect(rows.some((r) => r.includes("Starting yield (analyst assumption)"))).toBe(true);
    expect(rows.some((r) => r.includes("Starting value (analyst assumption)"))).toBe(true);
    expect(rows.some((r) => r.startsWith("Observation and quality|Observation date"))).toBe(false);
    expect(p.technical.find((g) => g.title === "Valuation basis")!.rows.some((r) => r.label === "Provenance" && r.value === "Analyst assumption")).toBe(true);
  });

  it("the largest driver card says so when its start is an assumption", () => {
    const heavy = view([kasaBond(28), gcb()], [corpClass(400)]);
    const driver = heavy.view.investigations.find((i) => i.kind === "LARGEST_DRIVER")!;
    expect(driver.dependsOnAssumption).toBe(true);
    expect(driver.why).toMatch(/starting valuation uses an analyst-supplied 28\.00% yield/);
  });

  it("an unvalued holding is still excluded, not assumed or zero", () => {
    const unvalued: ScenarioPosition = { ...kasaBond(28), valuation: valueBondPosition(1_500_000, CORP, UNV, VAL) };
    const r = view([govLong(), unvalued], [corpClass(300)]);
    expect(r.view.confidence.excluded).toBe(1);
    expect(r.view.headline.analytical).toBe(false);
    expect(r.view.headline.startingLabel).toBe("Reference Value");
  });
});

describe("a scenario depends on BOTH the starting assumption and the shock", () => {
  const at = (y: number, bps: number) => {
    const r = view([kasaBond(y)], [corpClass(bps)]);
    const p = r.result.positions[0];
    if (p.status !== "PARTICIPATING") throw new Error("participates");
    return p;
  };
  it("same shock, different starting yield → different starting value and different result", () => {
    const a = at(24, 300);
    const b = at(32, 300);
    expect(a.referenceValueGhs).not.toBe(b.referenceValueGhs);
    expect(a.scenarioValueGhs).not.toBe(b.scenarioValueGhs);
    expect(a.impactGhs).not.toBe(b.impactGhs);
  });
  it("scenario yield = starting assumption + shock", () => {
    const p = at(28, 300);
    if (p.detail.assetClass !== "BOND") throw new Error("bond");
    expect(p.detail.referenceYieldPct).toBe(28);
    expect(p.detail.scenarioYieldPct).toBeCloseTo(31, 12);
  });
});

describe("scenario comparison requires the same starting basis", () => {
  const rules = (n: number) => [corpClass(n)];
  const cmp = (a: ScenarioPosition[], b: ScenarioPosition[]) => buildComparison([{ id: "A", name: "A", result: run(a, rules(100)) }, { id: "B", name: "B", result: run(b, rules(300)) }]);

  it("same assumptions → common basis, and the note says only the scenario assumptions differ", () => {
    const c = cmp(book(28), book(28));
    expect(c.commonBasis).toBe(true);
    expect(c.basisNote).toMatch(/Every view uses the same 1 starting valuation assumption, so only the scenario assumptions differ/);
  });

  it("different starting assumptions → NOT a common basis, with a clear warning", () => {
    const c = cmp(book(28), book(31));
    expect(c.commonBasis).toBe(false);
    expect(c.valuationDate).toBeNull();
    // A different yield also changes the starting value, so both the basis and the assumptions are named in the warning.
    expect(c.basisNote).toMatch(/starting valuation assumptions differ.*not come only from the scenario assumptions/);
  });

  it("a different assumption that happens to give the same total value is still flagged (the fingerprint, not the total)", () => {
    const eq1: ScenarioPosition = { ...gcb(), valuation: valueEquityWithAssumption(100_000, { kind: "SHARE_PRICE_GHS", value: 10, overridesReference: false }, VAL) };
    const eq2: ScenarioPosition = { ...gcb(), valuation: valueEquityWithAssumption(200_000, { kind: "SHARE_PRICE_GHS", value: 5, overridesReference: false }, VAL) };
    expect(eq1.valuation.status === "VALUED" && eq2.valuation.status === "VALUED" && eq1.valuation.referenceValueGhs === eq2.valuation.referenceValueGhs).toBe(true);
    const c = buildComparison([{ id: "A", name: "A", result: run([eq1], [eqClass(-10)]) }, { id: "B", name: "B", result: run([eq2], [eqClass(-10)]) }]);
    expect(c.commonBasis).toBe(false);
    expect(c.basisNote).toMatch(/start from different valuation assumptions, so differences do not come only from the scenario assumptions/);
  });

  it("no assumptions anywhere → the established wording is unchanged", () => {
    const c = cmp([govLong(), kasa()], [govLong(), kasa()]);
    expect(c.commonBasis).toBe(true);
    expect(c.basisNote).toBe("Compared using the same current reference inputs.");
  });
});
