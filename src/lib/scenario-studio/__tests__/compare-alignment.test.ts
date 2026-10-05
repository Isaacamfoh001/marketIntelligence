import { describe, expect, it } from "vitest";
import { buildAssumptionRows, buildComparison, NO_ASSUMPTION_TEXT, type CompareInput } from "../compare";
import { corpClass, eqClass, govClass, govLongSecurity, kasaBondIssuer, KASA, MIXED, rule, run } from "./fixtures";
import type { ScenarioShockRule } from "../../scenarios";

const input = (id: string, rules: ScenarioShockRule[]): CompareInput => ({ id, name: id, result: run(MIXED(), rules) });
const kasaEquityIssuer = (v: number) => rule("kasa-eq", { kind: "ISSUER", issuerKey: KASA.key }, "PRICE_PCT", v, "Kasapreko Company PLC");
const rowOf = (rows: ReturnType<typeof buildAssumptionRows>, label: string) => rows.find((r) => r.label === label)!;

const A = () => input("A", [govClass(100), corpClass(150), govLongSecurity(250)]);
const B = () => input("B", [govClass(300), corpClass(500), eqClass(-15), kasaBondIssuer(700)]);

describe("assumptions align by semantic identity (the brief's example)", () => {
  const rows = buildAssumptionRows([A(), B()]);
  it("produces the exact matrix: one row per target, blanks where a scenario has none", () => {
    expect(rows.map((r) => [r.label, ...r.cells])).toEqual([
      ["Government bonds", "+100 bps", "+300 bps"],
      ["Corporate bonds", "+150 bps", "+500 bps"],
      ["Equities", null, "−15%"],
      ["Kasapreko Company PLC — bonds", null, "+700 bps"],
      ["GoG Jul-34", "+250 bps", null],
    ]);
  });
  it("orders asset classes, then issuers, then securities", () => {
    expect(rows.map((r) => r.level)).toEqual(["ASSET_CLASS", "ASSET_CLASS", "ASSET_CLASS", "ISSUER", "SECURITY"]);
  });
  it("is exposed on the comparison with one cell per column", () => {
    const c = buildComparison([A(), B()]);
    expect(c.assumptionRows).toEqual(rows);
    for (const r of c.assumptionRows) expect(r.cells).toHaveLength(c.columns.length);
  });
});

describe("alignment does not depend on order or counts", () => {
  it("same assumptions in different insertion order give identical rows", () => {
    const fwd = buildAssumptionRows([input("A", [govClass(100), eqClass(-5), kasaBondIssuer(300), govLongSecurity(50)]), B()]);
    const rev = buildAssumptionRows([input("A", [govLongSecurity(50), kasaBondIssuer(300), eqClass(-5), govClass(100)]), B()]);
    expect(rev).toEqual(fwd);
  });
  it("different assumption counts: every value sits in its own row", () => {
    const rows = buildAssumptionRows([input("A", [govClass(100)]), input("B", [govClass(300), eqClass(-15), kasaBondIssuer(700)])]);
    expect(rowOf(rows, "Government bonds").cells).toEqual(["+100 bps", "+300 bps"]);
    expect(rowOf(rows, "Equities").cells).toEqual([null, "−15%"]);
  });
  it("an assumption only in A, and only in B", () => {
    const rows = buildAssumptionRows([input("A", [govLongSecurity(250)]), input("B", [kasaBondIssuer(700)])]);
    expect(rowOf(rows, "GoG Jul-34").cells).toEqual(["+250 bps", null]);
    expect(rowOf(rows, "Kasapreko Company PLC — bonds").cells).toEqual([null, "+700 bps"]);
  });
  it("three scenarios: each row has three aligned cells", () => {
    const rows = buildAssumptionRows([A(), B(), input("C", [eqClass(0), govLongSecurity(400)])]);
    expect(rowOf(rows, "Government bonds").cells).toEqual(["+100 bps", "+300 bps", null]);
    expect(rowOf(rows, "Equities").cells).toEqual([null, "−15%", "0%"]);
    expect(rowOf(rows, "GoG Jul-34").cells).toEqual(["+250 bps", null, "+400 bps"]);
    expect(buildComparison([A(), B(), input("C", [])]).assumptionRows.every((r) => r.cells.length === 3)).toBe(true);
  });
});

describe("missing is not zero", () => {
  it("an explicit 0 is shown as a value; absence is null", () => {
    const rows = buildAssumptionRows([input("A", [govClass(0), eqClass(0)]), input("B", [])]);
    expect(rowOf(rows, "Government bonds").cells).toEqual(["0 bps", null]);
    expect(rowOf(rows, "Equities").cells).toEqual(["0%", null]);
    expect(NO_ASSUMPTION_TEXT).toBe("No specific assumption at this level.");
  });
  it("an explicit security-level 0 keeps its own row (it overrides the broader rule)", () => {
    const rows = buildAssumptionRows([input("A", [govClass(200), govLongSecurity(0)]), input("B", [govClass(200)])]);
    expect(rowOf(rows, "GoG Jul-34").cells).toEqual(["0 bps", null]);
    expect(rowOf(rows, "Government bonds").cells).toEqual(["+200 bps", "+200 bps"]);
  });
});

describe("identity distinguishes level and domain", () => {
  it("asset-class, issuer and security rows are separate even for the same name", () => {
    const sameNameIssuer = rule("i", { kind: "ISSUER", issuerKey: "name:gog" }, "YIELD_BPS", 10, "GoG Jul-34");
    const rows = buildAssumptionRows([input("A", [govLongSecurity(250)]), input("B", [sameNameIssuer])]);
    expect(rows).toHaveLength(2); // duplicate display label, different semantic identity
    expect(rows.filter((r) => r.label.startsWith("GoG Jul-34"))).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });
  it("the same issuer's bond and equity assumptions are two rows", () => {
    const rows = buildAssumptionRows([input("A", [kasaBondIssuer(500), kasaEquityIssuer(-5)]), input("B", [kasaBondIssuer(100)])]);
    expect(rowOf(rows, "Kasapreko Company PLC — bonds").cells).toEqual(["+500 bps", "+100 bps"]);
    expect(rowOf(rows, "Kasapreko Company PLC — equity").cells).toEqual(["−5%", null]);
  });
  it("same identity with different source labels collapses to ONE row with ONE canonical label", () => {
    const relabelled = rule("kasa-bonds", { kind: "ISSUER", issuerKey: KASA.key }, "YIELD_BPS", 700, "KASA");
    const rows = buildAssumptionRows([input("A", [kasaBondIssuer(500)]), input("B", [relabelled])]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(["+500 bps", "+700 bps"]);
    const flipped = buildAssumptionRows([input("B", [relabelled]), input("A", [kasaBondIssuer(500)])]);
    expect(flipped[0].label).toBe(rows[0].label); // label does not depend on column order
  });
  it("security rows are keyed by instrument, not label", () => {
    const other = rule("s2", { kind: "SECURITY", instrument: "BOND", instrumentId: "b-govshort" }, "YIELD_BPS", 250, "GoG Jul-34"); // same label, different bond
    const rows = buildAssumptionRows([input("A", [govLongSecurity(250)]), input("B", [other])]);
    expect(rows).toHaveLength(2);
  });
});
