import { describe, expect, it } from "vitest";
import { batchIdentity, bondKey, equityKey, filterBonds, filterEquities, MAX_BATCH_SIZE, removeBasketRow, toggleBasketRow, validateBatchEntries, type BatchEntryInput, type PickableBond, type PickableEquity } from "..";

const bond = (key = "BOND:b1", nominalGhs = "1,000,000"): BatchEntryInput => ({ key, assetClass: "BOND", instrumentId: key.split(":")[1], nominalGhs });
const eq = (key = "EQUITY:e1", shares = "100,000"): BatchEntryInput => ({ key, assetClass: "EQUITY", instrumentId: key.split(":")[1], shares });
const bill = (key = "BILL#1", over: Partial<Extract<BatchEntryInput, { assetClass: "TREASURY_BILL" }>> = {}): BatchEntryInput => ({ key, assetClass: "TREASURY_BILL", tenorDays: 364, maturityDate: "2027-06-07", faceValueGhs: "1,000,000", ...over });

describe("batch validation — each asset class keeps its own semantics", () => {
  it("accepts a mixed basket and parses each size in its own terms", () => {
    const r = validateBatchEntries([bond(), eq(), bill()]);
    expect(r).toEqual({
      ok: true,
      entries: [
        { key: "BOND:b1", assetClass: "BOND", instrumentId: "b1", nominalGhs: 1_000_000 },
        { key: "EQUITY:e1", assetClass: "EQUITY", instrumentId: "e1", shares: 100_000 },
        { key: "BILL#1", assetClass: "TREASURY_BILL", tenorDays: 364, maturityDate: "2027-06-07", faceValueGhs: 1_000_000, isin: null },
      ],
    });
  });
  it("equity requires whole, positive shares", () => {
    for (const bad of ["", "abc", "0", "-5", "10.5"]) {
      const r = validateBatchEntries([eq("EQUITY:e1", bad)]);
      expect(r.ok).toBe(false);
    }
  });
  it("bond requires a positive GHS nominal with at most two decimals", () => {
    expect(validateBatchEntries([bond("BOND:b1", "0")]).ok).toBe(false);
    expect(validateBatchEntries([bond("BOND:b1", "-1")]).ok).toBe(false);
    expect(validateBatchEntries([bond("BOND:b1", "1000.123")]).ok).toBe(false);
    expect(validateBatchEntries([bond("BOND:b1", "1000.12")]).ok).toBe(true);
  });
  it("T-bill requires a maturity date and a positive face amount", () => {
    expect(validateBatchEntries([bill("B", { maturityDate: "" })]).ok).toBe(false);
    expect(validateBatchEntries([bill("B", { faceValueGhs: "" })]).ok).toBe(false);
    expect(validateBatchEntries([bill("B", { faceValueGhs: "0" })]).ok).toBe(false);
  });
  it("a bond is never accepted with shares, nor an equity with a nominal (no generic quantity)", () => {
    const wrong = [{ key: "X", assetClass: "BOND", instrumentId: "b", shares: "10" }] as unknown as BatchEntryInput[];
    expect(validateBatchEntries(wrong).ok).toBe(false);
  });
  it("reports every failing row at once, keyed, so all can be fixed together", () => {
    const r = validateBatchEntries([bond("BOND:b1", ""), eq("EQUITY:e1", "1.5"), bill("B", { maturityDate: "" }), bond("BOND:b2", "500")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.key)).toEqual(["BOND:b1", "EQUITY:e1", "B"]);
  });
  it("rejects the same instrument twice and the same bill twice", () => {
    expect(validateBatchEntries([bond("BOND:b1"), { ...bond("BOND:b1"), key: "other" }]).ok).toBe(false);
    const r = validateBatchEntries([bill("B1"), bill("B2")]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ key: "B2", error: "This instrument is selected more than once." });
    expect(validateBatchEntries([bill("B1"), bill("B2", { maturityDate: "2027-07-07" })]).ok).toBe(true);
    expect(batchIdentity(bill("B1"))).toBe("BILL:364:2027-06-07");
  });
  it("rejects an empty basket and an oversized one", () => {
    expect(validateBatchEntries([])).toMatchObject({ ok: false });
    const many = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => bond(`BOND:b${i}`));
    expect(validateBatchEntries(many)).toMatchObject({ ok: false });
  });
  it("rejects an unknown instrument type instead of guessing", () => {
    const r = validateBatchEntries([{ key: "K", assetClass: "FUTURE" } as unknown as BatchEntryInput]);
    expect(r.ok).toBe(false);
  });
});

const bonds: (PickableBond & { id: string })[] = [
  { id: "g1", label: "GoG 20.00% Jul-34", issuerName: "Government of Ghana", instrumentCode: "GOG-34", instrumentType: "GOVERNMENT_BOND", addable: { addable: true } },
  { id: "g2", label: "GoG 19.75% Jul-31", issuerName: "Government of Ghana", instrumentCode: "GOG-31", instrumentType: "GOVERNMENT_BOND", addable: { addable: false } },
  { id: "c1", label: "Kasapreko 23.50% Sep-28", issuerName: "Kasapreko Company PLC", instrumentCode: "KAS-28", instrumentType: "CORPORATE_BOND", addable: { addable: true } },
];
const equities: (PickableEquity & { id: string })[] = [
  { id: "e1", ticker: "GCB", companyName: "GCB Bank PLC", addable: { addable: true } },
  { id: "e2", ticker: "MTNGH", companyName: "MTN Ghana", addable: { addable: true } },
  { id: "e3", ticker: "OLD", companyName: "Delisted Co", addable: { addable: false } },
];

describe("instrument picker: search and filter", () => {
  it("filters by asset class", () => {
    expect(filterBonds(bonds, "GOVERNMENT_BOND", "", false).map((b) => b.id)).toEqual(["g1"]);
    expect(filterBonds(bonds, "CORPORATE_BOND", "", false).map((b) => b.id)).toEqual(["c1"]);
    expect(filterBonds(bonds, "EQUITY", "", false)).toEqual([]);
    expect(filterEquities(equities, "GOVERNMENT_BOND", "", false)).toEqual([]);
  });
  it("search matches issuer, label, code and ticker, case-insensitively, word by word", () => {
    expect(filterBonds(bonds, "GOVERNMENT_BOND", "jul 34", false).map((b) => b.id)).toEqual(["g1"]);
    expect(filterBonds(bonds, "CORPORATE_BOND", "KASAPREKO", false).map((b) => b.id)).toEqual(["c1"]);
    expect(filterBonds(bonds, "CORPORATE_BOND", "kas-28", false).map((b) => b.id)).toEqual(["c1"]);
    expect(filterEquities(equities, "EQUITY", "mtn", false).map((e) => e.id)).toEqual(["e2"]);
    expect(filterEquities(equities, "EQUITY", "bank plc", false).map((e) => e.id)).toEqual(["e1"]);
    expect(filterEquities(equities, "EQUITY", "zzzz", false)).toEqual([]);
  });
  it("hides instruments that can never be held unless asked", () => {
    expect(filterBonds(bonds, "GOVERNMENT_BOND", "", true).map((b) => b.id)).toEqual(["g1", "g2"]);
    expect(filterEquities(equities, "EQUITY", "", false).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(filterEquities(equities, "EQUITY", "", true).map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
  it("keeps catalogue order (stable)", () => {
    expect(filterEquities(equities, "EQUITY", "", false).map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});

describe("basket: multi-selection, duplicates, removal", () => {
  const row = (key: string) => ({ key });
  it("selects several instruments across classes", () => {
    let rows: { key: string }[] = [];
    rows = toggleBasketRow(rows, row(bondKey("g1")));
    rows = toggleBasketRow(rows, row(equityKey("e1")));
    rows = toggleBasketRow(rows, row(equityKey("e2")));
    expect(rows.map((r) => r.key)).toEqual(["BOND:g1", "EQUITY:e1", "EQUITY:e2"]);
  });
  it("selecting the same instrument again unselects it — an instrument can never be in the basket twice", () => {
    let rows = toggleBasketRow([], row("BOND:g1"));
    rows = toggleBasketRow(rows, row("BOND:g1"));
    expect(rows).toEqual([]);
    rows = toggleBasketRow(toggleBasketRow(toggleBasketRow([], row("BOND:g1")), row("EQUITY:e1")), row("BOND:g1"));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("removes one instrument and leaves the rest in order", () => {
    const rows = ["BOND:g1", "EQUITY:e1", "EQUITY:e2"].map(row);
    expect(removeBasketRow(rows, "EQUITY:e1").map((r) => r.key)).toEqual(["BOND:g1", "EQUITY:e2"]);
    expect(removeBasketRow(rows, "missing")).toEqual(rows);
  });
});
