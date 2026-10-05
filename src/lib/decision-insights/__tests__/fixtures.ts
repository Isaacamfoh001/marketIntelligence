// Test fixtures for the decision-insights layer: real M8.1/M8.2/M8.3 domain functions fed with plain inputs.
import { selectLatestCompleteCurve, type AuctionRateRow } from "../../treasury-bills";
import type { BondTerms } from "../../fixed-income";
import {
  computeExposures,
  resolveBillValuationInput,
  resolveIssuerRef,
  summarizePortfolio,
  valueBillPosition,
  valueBondPosition,
  valueEquityPosition,
  type BondValuationInput,
  type EquityValuationInput,
  type ExposureAssetClass,
  type ExposurePosition,
  type PositionValuation,
  type Unvalued,
} from "../../portfolio";
import { runScenario, type ScenarioPosition, type ScenarioShockRule } from "../../scenarios";
import { buildStudioView, templateToRules, getTemplate } from "../../scenario-studio";
import type { WorkspaceInput } from "../holdings";

export const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const VAL = d("2026-10-05");
export const VAL_ISO = "2026-10-05";

const terms = (maturity: string, over: Partial<BondTerms> = {}): BondTerms => ({ issueDate: d("2022-01-15"), maturityDate: d(maturity), couponType: "FIXED", couponRatePct: 20, couponFrequency: "SEMI_ANNUAL", faceValue: 100, ...over });

const bondInput = (ytm: number, recency: "RECENT" | "STALE"): BondValuationInput => ({ available: true, assetClass: "BOND", observedYtmPct: ytm, observationDate: recency === "RECENT" ? "2026-10-01" : "2026-05-01", ageDays: recency === "RECENT" ? 4 : 157, recency, observedCleanPrice: null, yieldFromSourceQuote: true, pendingReview: null });

const eqInput = (price: number, recency: "RECENT" | "STALE", over: Partial<EquityValuationInput> = {}): EquityValuationInput => ({ available: true, assetClass: "EQUITY", priceGhs: price, priceDate: recency === "RECENT" ? "2026-10-02" : "2026-06-10", ageDays: recency === "RECENT" ? 3 : 117, recency, volume: 1000, valueTradedGhs: null, isActualTrade: true, latestReportDate: "2026-10-02", skippedNoTradeRows: 0, ...over });

const NO_INPUT: Unvalued = { available: false, code: "NO_OBSERVATION", reason: "No market observation has been imported for this bond." };

const row = (tenorDays: number, observationDate: string, interestRatePct: number): AuctionRateRow => ({ tenorDays, observationDate, interestRatePct, discountRatePct: 0, tenorLabel: "", tenderNumber: "2026" } as AuctionRateRow);
export const CURVE = selectLatestCompleteCurve([row(91, "2026-09-28", 4.6785), row(182, "2026-09-28", 6.37), row(364, "2026-09-28", 9.8339)], VAL_ISO)!;

const GOG = { companyId: null, issuerName: "Government of Ghana" };

export interface BondOpts {
  id: string;
  label?: string;
  nominal: number;
  maturity: string;
  coupon?: number;
  ytm?: number | null;
  recency?: "RECENT" | "STALE";
  issuer?: { companyId: string | null; issuerName: string };
}

export function bond(cls: "GOVERNMENT_BOND" | "CORPORATE_BOND", o: BondOpts): ExposurePosition {
  const t = terms(o.maturity, { couponRatePct: o.coupon ?? 20 });
  const valuation: PositionValuation = o.ytm === null || o.ytm === undefined ? valueBondPosition(o.nominal, t, NO_INPUT, VAL) : valueBondPosition(o.nominal, t, bondInput(o.ytm, o.recency ?? "RECENT"), VAL);
  return { positionId: o.id, label: o.label ?? o.id, assetClass: cls, issuer: resolveIssuerRef(o.issuer ?? (cls === "GOVERNMENT_BOND" ? GOG : { companyId: "co-corp", issuerName: "Kasapreko Company PLC" })), valuation, bond: { nominalGhs: o.nominal, currency: "GHS", status: "ACTIVE", terms: t, maturityConflict: false, couponConflict: false } };
}
export const gov = (o: BondOpts) => bond("GOVERNMENT_BOND", o);
export const corp = (o: BondOpts) => bond("CORPORATE_BOND", o);

export function equity(id: string, shares: number, price: number | null, o: { recency?: "RECENT" | "STALE"; issuer?: { companyId: string | null; issuerName: string }; reportDate?: string } = {}): ExposurePosition {
  const recency = o.recency ?? "RECENT";
  return {
    positionId: id,
    label: id,
    assetClass: "EQUITY" as ExposureAssetClass,
    issuer: resolveIssuerRef(o.issuer ?? { companyId: `co-${id}`, issuerName: `${id} PLC` }),
    valuation: price === null ? valueEquityPosition(shares, { available: false, code: "NO_TRADE", reason: "No trade recorded" }) : valueEquityPosition(shares, eqInput(price, recency, o.reportDate ? { latestReportDate: o.reportDate } : {})),
    bond: null,
  };
}

export function bill(id: string, face: number, maturity: string, tenor: 91 | 182 | 364, curve: typeof CURVE | null = CURVE): ExposurePosition {
  const issue = new Date(d(maturity).getTime() - tenor * 86_400_000);
  const input = resolveBillValuationInput({ currency: "GHS", tenorDays: tenor, issueDate: issue, maturityDate: d(maturity), curve }, VAL);
  return { positionId: id, label: `${tenor}-day T-bill ${id}`, assetClass: "TREASURY_BILL", issuer: resolveIssuerRef(GOG), valuation: valueBillPosition(face, input, VAL), bond: null, bill: { faceValueGhs: face, currency: "GHS", tenorDays: tenor, issueDate: issue, maturityDate: d(maturity) } };
}

export function workspace(positions: ExposurePosition[], portfolioId = "pf1"): WorkspaceInput {
  const summary = summarizePortfolio(positions.map((p) => p.valuation), VAL);
  return { portfolioId, valuationDate: VAL_ISO, summary, exposures: computeExposures(positions, summary, VAL), positions };
}

/** A representative mixed portfolio: bills, a long government bond, a corporate bond, two equities (one stale). */
export function mixed(): ExposurePosition[] {
  return [
    bill("B364", 1_000_000, "2027-06-07", 364),
    bill("B91", 600_000, "2026-12-04", 91),
    gov({ id: "GOG34", label: "GoG Jul-34", nominal: 1_500_000, maturity: "2034-07-10", ytm: 21 }),
    corp({ id: "KASA28", label: "Kasapreko Sep-28", nominal: 300_000, maturity: "2028-09-12", ytm: 24, recency: "STALE" }),
    equity("GCB", 100_000, 40),
    equity("MTN", 400_000, 6.5),
    equity("ALW", 200_000, 0.1, { recency: "STALE" }),
  ];
}

export function scenarioFor(positions: ExposurePosition[], rules: ScenarioShockRule[], name = "Test scenario") {
  const sp: ScenarioPosition[] = positions.map((p) => ({ positionId: p.positionId, label: p.label, assetClass: p.assetClass, issuer: p.issuer, instrumentId: p.positionId, valuation: p.valuation, terms: p.bond ? p.bond.terms : null }));
  const result = runScenario({ valuationDate: VAL, positions: sp, rules });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
  const view = buildStudioView({ result, links: {}, provenance: {} });
  return { result, view, name };
}

export const templateRules = (id: string) => templateToRules(getTemplate(id)!);

export const classRule = (assetClass: ExposureAssetClass, value: number): ScenarioShockRule => ({ id: `r-${assetClass}`, selector: { kind: "ASSET_CLASS", assetClass }, shockType: assetClass === "EQUITY" ? "PRICE_PCT" : "YIELD_BPS", value, targetLabel: assetClass });
