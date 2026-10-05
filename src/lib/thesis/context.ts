// ---------------------------------------------------------------------------
// "Current Korbly context" for a thesis subject (M9.1). Pure: it only RE-PRESENTS what
// the M7/M8/M9.0 layers already computed (instrument inputs, portfolio valuations) as
// labelled facts. It computes no new valuation, runs no scenario, and never says the
// data supports or refutes the thesis. Every fact carries its date or age where it has one.
// ---------------------------------------------------------------------------

import { computeDuration } from "../fixed-income/duration";
import type { BondInstrument, BillInstrument, EquityInstrument, PortfolioDetail, PositionRow } from "../queries/portfolio";
import type { ThesisSubjectKind } from "./types";

export interface ContextFact {
  label: string;
  value: string;
  /** Date / age / source qualifier shown beneath the value. */
  sub?: string;
  /** Set when the underlying evidence is older than Korbly's recency rule — informational, never a status change. */
  stale?: boolean;
}

export interface HeldRow {
  portfolioId: string;
  portfolioName: string;
  positionId: string;
  href: string;
  status: "VALUED" | "UNVALUED";
  /** What `valueGhs` is, in the M9.0.1 vocabulary. */
  valueLabel: "Reference Value" | "Indicative value" | "Analytical Starting Value" | null;
  valueGhs: number | null;
  /** Share of the portfolio's valued total; null when this holding or the portfolio total is unvalued. */
  weightPct: number | null;
  basis: "REFERENCE" | "INDICATIVE" | "ANALYST_ASSUMPTION" | null;
  /** FALLBACK = no Korbly value existed; OVERRIDE = the analyst chose a different start despite one. Null when no assumption is in force. */
  assumption: { kind: "FALLBACK" | "OVERRIDE"; summary: string; korblyValueGhs: number | null } | null;
  /** A stored assumption that is NOT currently used because Korbly now has its own value. */
  inactiveAssumptionSummary: string | null;
  unvaluedReason: string | null;
}

const VALUE_LABEL = { REFERENCE: "Reference Value", INDICATIVE: "Indicative value", ANALYST_ASSUMPTION: "Analytical Starting Value" } as const;
const ghs = (n: number) => `GHS ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ageText = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`);
const date = (iso: string) => iso.slice(0, 10);

export function equityContext(e: EquityInstrument): ContextFact[] {
  const facts: ContextFact[] = [{ label: "Listed company", value: `${e.companyName} (${e.ticker})` }];
  if (!e.input.available) return [...facts, { label: "Latest actual trade", value: "Not available", sub: e.input.reason, stale: true }];
  const i = e.input;
  return [
    ...facts,
    { label: "Latest actual trade", value: `GHS ${i.priceGhs.toFixed(2)}`, sub: `GSE closing price (VWAP) on ${date(i.priceDate)} · ${ageText(i.ageDays)}`, stale: i.recency === "STALE" },
    { label: "Shares traded that day", value: i.volume.toLocaleString("en-GB") },
  ];
}

export function bondContext(b: BondInstrument, valuationDate: Date): ContextFact[] {
  const facts: ContextFact[] = [
    { label: "Instrument", value: b.instrumentCode, sub: `${b.instrumentType === "GOVERNMENT_BOND" ? "Government" : "Corporate"} bond · ${b.issuerName}` },
    { label: "Coupon", value: b.couponRatePct === null ? (b.couponType === "ZERO_COUPON" ? "Zero coupon" : "Not recorded") : `${b.couponRatePct.toFixed(2)}% ${b.couponType.toLowerCase().replace("_", " ")}` },
    { label: "Maturity", value: date(b.maturityDate), sub: b.lifecycle === "ACTIVE" ? undefined : `Lifecycle: ${String(b.lifecycle).toLowerCase().replace(/_/g, " ")}` },
  ];
  if (!b.input.available) return [...facts, { label: "Latest reliable yield", value: "Not available", sub: b.input.reason, stale: true }];
  const i = b.input;
  facts.push({ label: "Latest reliable yield", value: `${i.observedYtmPct.toFixed(2)}%`, sub: `${i.yieldFromSourceQuote ? "source-quoted" : "from the traded price"} · observed ${date(i.observationDate)} · ${ageText(i.ageDays)}`, stale: i.recency === "STALE" });
  const d = computeDuration(b.terms, valuationDate, i.observedYtmPct);
  if (d.ok) facts.push({ label: "Rate sensitivity", value: `${d.modifiedDurationYears.toFixed(2)} years modified duration`, sub: "Approximate value change per 1 percentage-point move in yield, at the observed yield" });
  return facts;
}

export function billContext(tenorDays: number, curve: { observationDate: string; nodes: { tenorDays: number; interestRatePct: number }[] } | null, valuationDate: Date, bills: BillInstrument[]): ContextFact[] {
  const node = curve?.nodes.find((n) => n.tenorDays === tenorDays);
  const facts: ContextFact[] = [{ label: "Tenor", value: `${tenorDays}-day Treasury bill` }];
  if (!curve || !node) return [...facts, { label: "Latest auction rate", value: "Not available", sub: "No complete Bank of Ghana auction curve at the valuation date.", stale: true }];
  const age = Math.max(0, Math.round((valuationDate.getTime() - new Date(`${curve.observationDate}T00:00:00.000Z`).getTime()) / 86_400_000));
  facts.push({ label: "Latest auction rate", value: `${node.interestRatePct.toFixed(2)}%`, sub: `Bank of Ghana auction · ${date(curve.observationDate)} · ${ageText(age)}` });
  const held = bills.filter((b) => b.tenorDays === tenorDays).length;
  if (held > 0) facts.push({ label: "Dated bills recorded", value: String(held), sub: "Bills of this tenor already recorded in Korbly" });
  return facts;
}

/** The positions, across live portfolios, that hold this thesis's subject — reusing the portfolio's own valuations and weights. */
export function heldRows(portfolios: PortfolioDetail[], matches: (p: PositionRow) => boolean): HeldRow[] {
  const rows: HeldRow[] = [];
  for (const pf of portfolios) {
    if (pf.archivedAt) continue;
    for (const p of pf.positions) {
      if (!matches(p)) continue;
      const v = p.valuation;
      const total = pf.summary.referenceValueGhs;
      const base = { portfolioId: pf.id, portfolioName: pf.name, positionId: p.positionId, href: `/portfolios/${pf.id}?view=holdings&position=${p.positionId}#inspect` };
      if (v.status !== "VALUED") {
        rows.push({ ...base, status: "UNVALUED", valueLabel: null, valueGhs: null, weightPct: null, basis: null, assumption: null, inactiveAssumptionSummary: null, unvaluedReason: v.reason });
        continue;
      }
      rows.push({
        ...base,
        status: "VALUED",
        valueLabel: VALUE_LABEL[v.basis],
        valueGhs: v.referenceValueGhs,
        weightPct: total && total > 0 ? (v.referenceValueGhs / total) * 100 : null,
        basis: v.basis,
        assumption: v.basis === "ANALYST_ASSUMPTION" && v.assumption ? { kind: v.korblyBasis ? "OVERRIDE" : "FALLBACK", summary: v.assumption.summary, korblyValueGhs: v.korblyBasis?.valueGhs ?? null } : null,
        inactiveAssumptionSummary: v.ignoredAssumption?.summary ?? null,
        unvaluedReason: null,
      });
    }
  }
  return rows;
}

export const formatHeldValue = (r: HeldRow) => (r.valueGhs === null ? "Not valued" : ghs(r.valueGhs));

export const SUBJECT_HREF = (kind: ThesisSubjectKind, code: string) => (kind === "EQUITY" ? `/companies/${code}` : kind === "TREASURY_BILL" ? "/macro-rates" : `/fixed-income/${code}`);
