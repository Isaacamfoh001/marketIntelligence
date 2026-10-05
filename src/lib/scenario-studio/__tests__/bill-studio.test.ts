import { describe, expect, it } from "vitest";
import { buildStudioView } from "../view-model";
import { buildComparison } from "../compare";
import { describeAssumptionPlain, previewAssumption, toShockValue, technicalLabel } from "../language";
import { SCENARIO_TEMPLATES } from "../templates";
import { resolveBillValuationInput, valueBillPosition } from "../../portfolio";
import { selectLatestCompleteCurve } from "../../treasury-bills";
import type { ScenarioPosition } from "../../scenarios";
import { corpClass, eqClass, GOV, govClass, govLong, kasa, linksFor, rule, run, VAL } from "./fixtures";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const r = (tenorDays: number, v: number) => ({ tenorDays, observationDate: "2026-09-28", interestRatePct: v, discountRatePct: 0, tenderNumber: "2026" });
const CURVE = selectLatestCompleteCurve([r(91, 4.6785), r(182, 6.37), r(364, 9.8339)], "2026-10-05");
const bill = (maturity = "2027-06-07", tenor = 364, face = 1_000_000, curve = CURVE): ScenarioPosition => ({
  positionId: "p-bill",
  label: `${tenor}-day T-bill · ${maturity}`,
  assetClass: "TREASURY_BILL",
  issuer: GOV,
  instrumentId: "bill-1",
  valuation: valueBillPosition(face, resolveBillValuationInput({ currency: "GHS", tenorDays: tenor, issueDate: new Date(d(maturity).getTime() - tenor * 86_400_000), maturityDate: d(maturity), curve }, VAL), VAL),
  terms: null,
});
const billClass = (v: number) => rule("tb", { kind: "ASSET_CLASS", assetClass: "TREASURY_BILL" }, "YIELD_BPS", v, "Treasury bills");

describe("Scenario Studio language — Treasury bills", () => {
  it("human wording says percentage points, not bps", () => {
    expect(describeAssumptionPlain(billClass(200))).toBe("Treasury-bill rates rise by 2.0 percentage points.");
    expect(describeAssumptionPlain(billClass(-100))).toBe("Treasury-bill rates fall by 1.0 percentage points.");
    expect(technicalLabel(billClass(200))).toBe("+200 bps");
  });
  it("explicit zero is a stated assumption, distinct from none", () => {
    expect(describeAssumptionPlain(billClass(0))).toBe("Treasury-bill rates are held unchanged.");
  });
  it("human (2.0 pp) and advanced (200 bps) input resolve to the identical stored value", () => {
    const a = toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 2, unit: "PP" });
    const b = toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 200, unit: "BPS" });
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: true, value: 200 });
    const sel = { kind: "ASSET_CLASS", assetClass: "TREASURY_BILL" } as const;
    const p = previewAssumption({ selector: sel, targetLabel: "Treasury bills", shockType: "YIELD_BPS", direction: "UP", amountText: "2.0", unit: "PP" });
    expect(p.ok && p.plain).toBe("Treasury-bill rates rise by 2.0 percentage points.");
  });
  it("a specific bill is described as a rate; the Government of Ghana issuer wording includes bills, other issuers do not", () => {
    expect(describeAssumptionPlain({ selector: { kind: "SECURITY", instrument: "TREASURY_BILL" }, shockType: "YIELD_BPS", value: 100, targetLabel: "364-day T-bill" })).toBe("364-day T-bill rate rises by 1.0 percentage points.");
    expect(describeAssumptionPlain({ selector: { kind: "ISSUER" }, shockType: "YIELD_BPS", value: 100, targetLabel: "Government of Ghana" })).toBe("Government of Ghana bond yields and Treasury-bill rates rise by 1.0 percentage points.");
    expect(describeAssumptionPlain({ selector: { kind: "ISSUER" }, shockType: "YIELD_BPS", value: 100, targetLabel: "Kasapreko Company PLC" })).toBe("Kasapreko Company PLC bond yields rise by 1.0 percentage points.");
  });
  it("templates that stress rates include the Treasury-bill rate, every value is in bounds, and no forecast language is used", () => {
    const rp = SCENARIO_TEMPLATES.find((t) => t.id === "rate-pressure")!;
    expect(rp.assumptions[0]).toEqual({ assetClass: "TREASURY_BILL", value: 200 });
    expect(SCENARIO_TEMPLATES.find((t) => t.id === "equity-pullback")!.assumptions.some((a) => a.assetClass === "TREASURY_BILL")).toBe(false);
    expect(SCENARIO_TEMPLATES.map((t) => t.blurb).join(" ")).not.toMatch(/likely|expected|forecast|bullish|bearish/i);
  });
});

describe("Scenario Studio view — Treasury bill", () => {
  const result = run([bill()], [billClass(200)]);
  const v = buildStudioView({ result, links: linksFor(result), provenance: {} });
  const pv = v.positions[0];

  it("headline and impact are the engine's figures, never recomputed", () => {
    expect(v.headline.impactGhs).toBe(result.portfolio.impactGhs);
    expect(v.headline.impactGhs).toBe(-12_004.53);
    expect(v.headline.sentence).toMatch(/^Under these assumptions, the valued portfolio falls by 1\.26% \(about GHS 12,005\)\.$/);
  });
  it("plain-language consequence explains rate ↔ value and states face value, days and the new value", () => {
    expect(pv.simple[0]).toMatch(/its reference rate rises from 7\.57% to 9\.57%/);
    expect(pv.simple[0]).toMatch(/pays its face value of GHS 1\.00m in 245 days/);
    expect(pv.simple[0]).toMatch(/its value falls from GHS 951\.7k to GHS 939\.6k/);
    expect(pv.simple[0]).not.toMatch(/bps|DV01|discount factor|compound/i);
  });
  it("the Treasury-bill class is a named driver", () => {
    expect(v.mainClass).toMatchObject({ assetClass: "TREASURY_BILL", label: "Treasury bills" });
    expect(v.assumptions[0].plain).toBe("Treasury-bill rates rise by 2.0 percentage points.");
  });
  it("technical drilldown carries every field an expert needs", () => {
    const rows = Object.fromEntries(pv.technical.flatMap((g) => g.rows.map((x) => [x.label, x.value])));
    expect(rows["Face (maturity) value"]).toBe("GHS 1,000,000.00");
    expect(rows["Days to maturity"]).toBe("245");
    expect(rows["Reference rate"]).toBe("7.5690%");
    expect(rows["Scenario rate"]).toBe("9.5690%");
    expect(rows["Applied assumption"]).toBe("+200 bps");
    expect(rows["Convention"]).toBe("Simple interest, Actual/365");
    expect(rows["Formula"]).toMatch(/÷ \(1 \+ rate × days remaining ÷ 365\)/);
    expect(rows["Reference value"]).toBe("GHS 951,650.54");
    expect(rows["Scenario value"]).toBe("GHS 939,646.01");
    expect(rows["Exact impact"]).toBe("−GHS 12,004.53");
    expect(rows["DV01"]).toMatch(/^GHS 60\.79\/bp$/);
    expect(rows["First-order DV01 estimate"]).toBe("−GHS 12,157.89");
    expect(rows["Observation date"]).toBeTruthy();
    expect(rows["Recent or stale"]).toBe("Recent");
  });
  it("unchanged bill (no assumption) keeps its starting value and says so", () => {
    const res = run([bill(), govLong()], [govClass(100)]);
    const vv = buildStudioView({ result: res, links: linksFor(res), provenance: {} });
    expect(vv.positions.find((p) => p.positionId === "p-bill")!.simple[0]).toMatch(/No assumption reaches this holding, so it keeps its starting value of GHS 951\.7k \(reference rate 7\.57%, 245 days to maturity\)/);
  });
  it("stale-input propagation shows the stale note on the bill and a stale-dependence flag", () => {
    const old = selectLatestCompleteCurve([{ ...r(91, 4.6785), observationDate: "2026-08-10" }, { ...r(182, 6.37), observationDate: "2026-08-10" }, { ...r(364, 9.8339), observationDate: "2026-08-10" }], "2026-10-05");
    const res = run([bill("2027-06-07", 364, 1_000_000, old)], [billClass(200)]);
    const vv = buildStudioView({ result: res, links: linksFor(res), provenance: {} });
    expect(vv.positions[0].recency).toBe("STALE");
    expect(vv.positions[0].freshnessNote).toBeTruthy();
    expect(vv.confidence.flags.map((f) => f.code)).toContain("STALE_DEPENDENCE");
  });
  it("an unvalued bill is explained as excluded, not as zero", () => {
    const res = run([bill("2027-06-07", 364, 1_000_000, null), govLong()], [billClass(200), govClass(100)]);
    const vv = buildStudioView({ result: res, links: linksFor(res), provenance: {} });
    const p = vv.positions.find((x) => x.positionId === "p-bill")!;
    expect(p.status).toBe("UNAVAILABLE");
    expect(p.impactGhs).toBeNull();
    expect(p.technical[0].rows[0].value).toMatch(/No complete Bank of Ghana auction curve/);
  });
});

describe("comparison with a Treasury-bill column", () => {
  it("the Treasury-bill class assumption is aligned per scenario, with the engine's class impact", () => {
    const a = run([bill(), govLong(), kasa()], [billClass(200), govClass(200), eqClass(-10)]);
    const b = run([bill(), govLong(), kasa()], [billClass(-100), corpClass(0)]);
    const c = buildComparison([{ id: "a", name: "Up", result: a }, { id: "b", name: "Down", result: b }]);
    expect(c.columns[0].classAssumptions.TREASURY_BILL).toBe("+200 bps");
    expect(c.columns[1].classAssumptions.TREASURY_BILL).toBe("−100 bps");
    expect(c.columns[0].classImpacts[0]).toMatchObject({ assetClass: "TREASURY_BILL", label: "Treasury bills", impactGhs: -12_004.53 });
    expect(c.columns[1].classImpacts[0].impactGhs).toBe(6_118.02);
  });
});
