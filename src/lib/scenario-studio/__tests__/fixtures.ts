// Shared fixtures for Scenario Studio tests: a mixed portfolio shaped like the real demo one.
import { valueBondPosition, valueEquityPosition, type BondValuationInput, type EquityValuationInput, type Unvalued } from "../../portfolio";
import type { BondTerms } from "../../fixed-income";
import { runScenario, type ScenarioPosition, type ScenarioShockRule } from "../../scenarios";
import type { OkResult, PositionLinks } from "../view-model";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const VAL = d("2026-10-05");
const GOV_LONG: BondTerms = { issueDate: d("2024-07-01"), maturityDate: d("2034-07-01"), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const GOV_SHORT: BondTerms = { issueDate: d("2023-01-01"), maturityDate: d("2028-01-01"), couponType: "FIXED", couponRatePct: 15, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };
const CORP: BondTerms = { issueDate: d("2025-09-01"), maturityDate: d("2028-09-01"), couponType: "FIXED", couponRatePct: 22, couponFrequency: "SEMI_ANNUAL", faceValue: 100 };

export const bondIn = (ytm: number, over: Partial<BondValuationInput> = {}): BondValuationInput => ({ available: true, assetClass: "BOND", observedYtmPct: ytm, observationDate: "2026-10-01", ageDays: 4, recency: "RECENT", observedCleanPrice: null, yieldFromSourceQuote: false, pendingReview: null, ...over });
export const eqIn = (price: number, over: Partial<EquityValuationInput> = {}): EquityValuationInput => ({ available: true, assetClass: "EQUITY", priceGhs: price, priceDate: "2026-10-03", ageDays: 2, recency: "RECENT", volume: 1000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-03", skippedNoTradeRows: 0, ...over });
export const UNV: Unvalued = { available: false, code: "NO_OBSERVATION", reason: "No usable observation." };

export const GOV = { key: "name:government of ghana", name: "Government of Ghana" };
export const KASA = { key: "company:kasa", name: "Kasapreko Company PLC" };
export const GCB = { key: "company:gcb", name: "GCB" };
export const CAL = { key: "company:cal", name: "CALPREF" };

export const govLong = (): ScenarioPosition => ({ positionId: "p-govlong", label: "GoG Jul-34", assetClass: "GOVERNMENT_BOND", issuer: GOV, instrumentId: "b-govlong", valuation: valueBondPosition(2_000_000, GOV_LONG, bondIn(28.0073), VAL), terms: GOV_LONG });
export const govShort = (): ScenarioPosition => ({ positionId: "p-govshort", label: "GoG Jan-28", assetClass: "GOVERNMENT_BOND", issuer: GOV, instrumentId: "b-govshort", valuation: valueBondPosition(2_000_000, GOV_SHORT, bondIn(24), VAL), terms: GOV_SHORT });
export const corp = (): ScenarioPosition => ({ positionId: "p-corp", label: "Kasapreko Sep-28", assetClass: "CORPORATE_BOND", issuer: KASA, instrumentId: "b-corp", valuation: valueBondPosition(2_000_000, CORP, bondIn(26, { recency: "STALE", ageDays: 20, observationDate: "2026-09-15" }), VAL), terms: CORP });
export const kasa = (): ScenarioPosition => ({ positionId: "p-kasa", label: "KASA", assetClass: "EQUITY", issuer: KASA, instrumentId: "s-kasa", valuation: valueEquityPosition(100_000, eqIn(10)), terms: null });
export const gcb = (): ScenarioPosition => ({ positionId: "p-gcb", label: "GCB", assetClass: "EQUITY", issuer: GCB, instrumentId: "s-gcb", valuation: valueEquityPosition(500_000, eqIn(4.5)), terms: null });
export const calpref = (): ScenarioPosition => ({ positionId: "p-calpref", label: "CALPREF", assetClass: "EQUITY", issuer: CAL, instrumentId: "s-calpref", valuation: valueEquityPosition(1000, UNV), terms: null });

export const MIXED = () => [govLong(), govShort(), corp(), kasa(), gcb(), calpref()];

export const rule = (id: string, selector: ScenarioShockRule["selector"], shockType: ScenarioShockRule["shockType"], value: number, targetLabel = id): ScenarioShockRule => ({ id, selector, shockType, value, targetLabel });
export const govClass = (v: number) => rule("gov", { kind: "ASSET_CLASS", assetClass: "GOVERNMENT_BOND" }, "YIELD_BPS", v, "Government bonds");
export const corpClass = (v: number) => rule("corp", { kind: "ASSET_CLASS", assetClass: "CORPORATE_BOND" }, "YIELD_BPS", v, "Corporate bonds");
export const eqClass = (v: number) => rule("eq", { kind: "ASSET_CLASS", assetClass: "EQUITY" }, "PRICE_PCT", v, "Equities");
export const kasaBondIssuer = (v: number) => rule("kasa-bonds", { kind: "ISSUER", issuerKey: KASA.key }, "YIELD_BPS", v, "Kasapreko Company PLC");
export const govLongSecurity = (v: number) => rule("sec-govlong", { kind: "SECURITY", instrument: "BOND", instrumentId: "b-govlong" }, "YIELD_BPS", v, "GoG Jul-34");

export function run(positions: ScenarioPosition[], rules: ScenarioShockRule[]): OkResult {
  const r = runScenario({ valuationDate: VAL, positions, rules });
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  return r;
}

export const linksFor = (r: OkResult): Record<string, PositionLinks> =>
  Object.fromEntries(r.positions.map((p) => [p.positionId, { analysis: { href: `/analysis/${p.positionId}`, label: "Open analysis" }, evidence: { href: `/evidence/${p.positionId}`, label: "Review evidence" }, inspect: { href: `/inspect/${p.positionId}`, label: "Inspect position" } }]));
