import { describe, expect, it } from "vitest";
import { describeAssumptionPlain, percentagePoints, previewAssumption, technicalLabel, toHumanInput, toShockValue } from "../language";
import { SCENARIO_TEMPLATES, TEMPLATE_DISCLAIMER } from "../templates";
import { validateShockValue } from "../../scenarios";
import { govClass, eqClass, kasaBondIssuer, govLongSecurity, rule, KASA } from "./fixtures";

describe("human ↔ expert input resolve to the same rule value", () => {
  it("2.0 percentage points and +200 bps are identical", () => {
    const human = toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 2, unit: "PP" });
    const expert = toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 200, unit: "BPS" });
    expect(human).toEqual({ ok: true, value: 200 });
    expect(expert).toEqual(human);
  });
  it("handles fractional points exactly (1.75 pp = 175 bps; 0.07 pp = 7 bps)", () => {
    expect(toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 1.75, unit: "PP" })).toEqual({ ok: true, value: 175 });
    expect(toShockValue({ shockType: "YIELD_BPS", direction: "DOWN", amount: 0.07, unit: "PP" })).toEqual({ ok: true, value: -7 });
  });
  it("direction supplies the sign; equity falls give negative percent", () => {
    expect(toShockValue({ shockType: "YIELD_BPS", direction: "DOWN", amount: 2, unit: "PP" })).toEqual({ ok: true, value: -200 });
    expect(toShockValue({ shockType: "PRICE_PCT", direction: "DOWN", amount: 10, unit: "PCT" })).toEqual({ ok: true, value: -10 });
  });
  it("zero is +0, never −0", () => {
    const r = toShockValue({ shockType: "PRICE_PCT", direction: "DOWN", amount: 0, unit: "PCT" });
    expect(r.ok && Object.is(r.value, 0)).toBe(true);
  });
  it("rejects negative amounts, wrong units and out-of-bounds values (never clamps)", () => {
    expect(toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: -1, unit: "PP" }).ok).toBe(false);
    expect(toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 5, unit: "PCT" }).ok).toBe(false);
    expect(toShockValue({ shockType: "PRICE_PCT", direction: "UP", amount: 5, unit: "PP" }).ok).toBe(false);
    expect(toShockValue({ shockType: "YIELD_BPS", direction: "UP", amount: 21, unit: "PP" }).ok).toBe(false);
    expect(toShockValue({ shockType: "PRICE_PCT", direction: "DOWN", amount: 101, unit: "PCT" }).ok).toBe(false);
    expect(toShockValue({ shockType: "PRICE_PCT", direction: "DOWN", amount: Number.NaN, unit: "PCT" }).ok).toBe(false);
  });
  it("round-trips through toHumanInput", () => {
    expect(toHumanInput("YIELD_BPS", -175)).toEqual({ direction: "DOWN", amount: 1.75, unit: "PP" });
    expect(toHumanInput("PRICE_PCT", -10)).toEqual({ direction: "DOWN", amount: 10, unit: "PCT" });
  });
});

describe("plain-English translation", () => {
  it("+200bps becomes 'yields rise by 2.0 percentage points'", () => {
    expect(describeAssumptionPlain(govClass(200))).toBe("Government bond yields rise by 2.0 percentage points.");
    expect(technicalLabel(govClass(200))).toBe("+200 bps");
  });
  it("-200bps becomes 'yields fall by 2.0 percentage points'", () => {
    expect(describeAssumptionPlain(govClass(-200))).toBe("Government bond yields fall by 2.0 percentage points.");
    expect(technicalLabel(govClass(-200))).toBe("−200 bps");
  });
  it("equity -10 becomes 'equity prices fall by 10%'", () => {
    expect(describeAssumptionPlain(eqClass(-10))).toBe("Equity prices fall by 10%.");
    expect(technicalLabel(eqClass(-10))).toBe("−10%");
  });
  it("an explicit zero is described as unchanged", () => {
    expect(describeAssumptionPlain(eqClass(0))).toBe("Equity prices are held unchanged.");
    expect(describeAssumptionPlain(govClass(0))).toBe("Government bond yields are held unchanged.");
  });
  it("issuer and security assumptions name their target and the thing that moves", () => {
    expect(describeAssumptionPlain(kasaBondIssuer(500))).toBe("Kasapreko Company PLC bond yields rise by 5.0 percentage points.");
    expect(describeAssumptionPlain(govLongSecurity(400))).toBe("GoG Jul-34 yield rises by 4.0 percentage points.");
    expect(describeAssumptionPlain(rule("x", { kind: "SECURITY", instrument: "EQUITY", instrumentId: "s" }, "PRICE_PCT", -5, "GCB"))).toBe("GCB share price falls by 5%.");
    expect(describeAssumptionPlain(rule("y", { kind: "ISSUER", issuerKey: KASA.key }, "PRICE_PCT", 5, "Kasapreko Company PLC"))).toBe("Kasapreko Company PLC share price rises by 5%.");
  });
  it("percentage points use one decimal when exact, two otherwise", () => {
    expect(percentagePoints(200)).toBe("2.0 percentage points");
    expect(percentagePoints(-175)).toBe("1.75 percentage points");
    expect(percentagePoints(50)).toBe("0.5 percentage points");
  });
  it("preview resolves human and advanced input to the same technical label", () => {
    const sel = { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" } as const;
    const a = previewAssumption({ selector: sel, targetLabel: "Government bonds", shockType: "YIELD_BPS", direction: "UP", amountText: "2.0", unit: "PP" });
    const b = previewAssumption({ selector: sel, targetLabel: "Government bonds", shockType: "YIELD_BPS", direction: "UP", amountText: "200", unit: "BPS" });
    expect(a).toEqual(b);
    expect(a.ok && a.technical).toBe("+200 bps");
    expect(previewAssumption({ selector: sel, targetLabel: "x", shockType: "YIELD_BPS", direction: "UP", amountText: "", unit: "PP" })).toEqual({ ok: false, message: null });
    expect(previewAssumption({ selector: sel, targetLabel: "x", shockType: "YIELD_BPS", direction: "UP", amountText: "abc", unit: "PP" }).ok).toBe(false);
  });
});

describe("templates", () => {
  it("are hypothetical starting points with valid, in-bounds engine values", () => {
    expect(TEMPLATE_DISCLAIMER).toBe("Hypothetical starting point — edit these assumptions.");
    for (const t of SCENARIO_TEMPLATES) for (const a of t.assumptions) expect(validateShockValue(a.assetClass === "EQUITY" ? "PRICE_PCT" : "YIELD_BPS", a.value).ok).toBe(true);
  });
  it("match the product brief", () => {
    const by = Object.fromEntries(SCENARIO_TEMPLATES.map((t) => [t.id, t.assumptions.map((a) => `${a.assetClass}:${a.value}`)]));
    expect(by["rate-pressure"]).toEqual(["TREASURY_BILL:200", "GOVERNMENT_BOND:200", "CORPORATE_BOND:300", "EQUITY:0"]);
    expect(by["broad-selloff"]).toEqual(["TREASURY_BILL:200", "GOVERNMENT_BOND:200", "CORPORATE_BOND:300", "EQUITY:-10"]);
    expect(by["equity-pullback"]).toEqual(["EQUITY:-10"]);
  });
  it("never use forecast language", () => {
    const text = SCENARIO_TEMPLATES.map((t) => `${t.name} ${t.blurb}`).join(" ");
    expect(text).not.toMatch(/bullish|bearish|likely|expected|forecast|prediction|korbly view/i);
  });
});
