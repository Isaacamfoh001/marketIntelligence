"use client";

// ---------------------------------------------------------------------------
// Portfolio builder (M9.0): search and browse Ghanaian instruments by asset
// class, tick several, review the selected basket, enter each position in ITS
// OWN terms (bond nominal GHS · equity whole shares · Treasury bill tenor +
// maturity + face), see each row's reference value before saving, then add
// everything in one step. All-or-nothing: if any row is invalid nothing is
// saved and every problem is shown against its row.
//
// A holding Korbly cannot value for lack of market evidence is flagged "No reliable
// Reference Value": the analyst may leave it unvalued (the default — nothing is ever
// assumed silently) or choose an explicit valuation assumption, shown with its exact
// result and labelled as an assumption. Instruments missing contract terms stay
// unavailable. The whole basket still saves all-or-nothing.
//
// Validation and valuation are the pure domain functions; this component only
// wires them to inputs. The server re-validates every row.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { BILL_TENORS, checkBillIssued, parseIsoDate, validateBillTerms, type AuctionCurve } from "@/lib/treasury-bills";
import {
  ASSUMPTION_DISCLOSURE,
  ASSUMPTION_HELP,
  ASSUMPTION_KIND_LABEL,
  ASSUMPTION_UNIT,
  assumptionAvailability,
  bondKey,
  checkBillAddable,
  equityKey,
  filterBonds,
  filterEquities,
  heldBillKey,
  parseEnteredNumber,
  removeBasketRow,
  toggleBasketRow,
  resolveBillValuationInput,
  summarizePortfolio,
  UNVALUED_LABEL,
  validatePositionDraft,
  valueBillPosition,
  valueBondPosition,
  valueEquityPosition,
  valueWithAssumption,
  type AssumptionAvailability,
  type AssumptionKind,
  type AssumptionSubject,
  type PositionValuation,
} from "@/lib/portfolio";
import { billDaysToMaturity } from "@/lib/treasury-bills";
import { formatGhs, formatIsoDate, formatPct } from "@/lib/fixed-income";
import type { BondInstrument, EquityInstrument } from "@/lib/queries/portfolio";
import type { BatchFormState } from "@/app/portfolios/actions";
import { AssetBadge, ageText, RecencyBadge } from "./ui";
import { BasisBadge, ValuationBasisBar } from "./basis";

type Tab = "TREASURY_BILL" | "GOVERNMENT_BOND" | "CORPORATE_BOND" | "EQUITY";
const TABS: { id: Tab; label: string }[] = [
  { id: "TREASURY_BILL", label: "Treasury bills" },
  { id: "GOVERNMENT_BOND", label: "Government bonds" },
  { id: "CORPORATE_BOND", label: "Corporate bonds" },
  { id: "EQUITY", label: "Equities" },
];

interface BasketRow {
  key: string;
  kind: "BOND" | "EQUITY" | "TREASURY_BILL";
  instrumentId: string;
  size: string;
  tenorDays: number;
  maturityDate: string;
  /** The analyst's optional starting assumption; kind "" = none (the row stays unvalued if Korbly cannot value it). */
  asm: { kind: AssumptionKind | ""; value: string };
}

interface RowPreview {
  /** The value the row would be carried at: Korbly's, the analyst's assumption, or unvalued. */
  valuation: PositionValuation | null;
  /** What Korbly alone supports. */
  korbly: PositionValuation | null;
  /** Whether an assumption could responsibly stand in (only when Korbly is unvalued). */
  avail: AssumptionAvailability | null;
  subject: AssumptionSubject | null;
  error: string | null;
  assumptionError: string | null;
  value: number | null;
}

const INPUT = "w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";

export function BasketBuilder({
  bonds,
  equities,
  held,
  curve,
  portfolioId,
  valuationDateIso,
  action,
}: {
  bonds: BondInstrument[];
  equities: EquityInstrument[];
  /** "BOND:<id>" | "EQUITY:<id>" | "BILL:<tenor>:<maturity>" → existing positionId. */
  held: Record<string, string>;
  curve: AuctionCurve | null;
  portfolioId: string;
  valuationDateIso: string;
  action: (prev: BatchFormState, formData: FormData) => Promise<BatchFormState>;
}) {
  const [state, formAction, pending] = useActionState<BatchFormState, FormData>(action, {});
  const [tab, setTab] = useState<Tab>("GOVERNMENT_BOND");
  const [query, setQuery] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  const [rows, setRows] = useState<BasketRow[]>([]);
  const [billSeq, setBillSeq] = useState(1);
  const valuationDate = useMemo(() => new Date(`${valuationDateIso}T00:00:00.000Z`), [valuationDateIso]);

  const bondById = useMemo(() => new Map(bonds.map((b) => [b.id, b])), [bonds]);
  const equityById = useMemo(() => new Map(equities.map((e) => [e.id, e])), [equities]);
  const selectedKeys = new Set(rows.map((r) => r.key));

  const counts: Record<Tab, number> = {
    TREASURY_BILL: rows.filter((r) => r.kind === "TREASURY_BILL").length,
    GOVERNMENT_BOND: rows.filter((r) => r.kind === "BOND" && bondById.get(r.instrumentId)?.instrumentType === "GOVERNMENT_BOND").length,
    CORPORATE_BOND: rows.filter((r) => r.kind === "BOND" && bondById.get(r.instrumentId)?.instrumentType === "CORPORATE_BOND").length,
    EQUITY: rows.filter((r) => r.kind === "EQUITY").length,
  };

  const bondList = filterBonds(bonds, tab, query, showBlocked);
  const equityList = filterEquities(equities, tab, query, showBlocked);
  const blockedHere = tab === "EQUITY" ? equities.filter((e) => !e.addable.addable).length : tab === "TREASURY_BILL" ? 0 : bonds.filter((b) => b.instrumentType === tab && !b.addable.addable).length;

  const toggle = (row: Omit<BasketRow, "size" | "tenorDays" | "maturityDate" | "asm">) => setRows((cur) => toggleBasketRow(cur, { ...row, size: "", tenorDays: 91, maturityDate: "", asm: { kind: "", value: "" } }));
  const update = (key: string, patch: Partial<BasketRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows((cur) => removeBasketRow(cur, key));
  const addBill = (tenorDays: number) => {
    setRows((cur) => [...cur, { key: `BILL#${billSeq}`, kind: "TREASURY_BILL", instrumentId: "", size: "", tenorDays, maturityDate: "", asm: { kind: "", value: "" } }]);
    setBillSeq((n) => n + 1);
  };

  const none: RowPreview = { valuation: null, korbly: null, avail: null, subject: null, error: null, assumptionError: null, value: null };
  const fail = (error: string): RowPreview => ({ ...none, error });

  /** Korbly's own valuation first; an analyst assumption only where Korbly has none AND the instrument can take one. */
  const finalize = (r: BasketRow, assetClass: "BOND" | "EQUITY" | "TREASURY_BILL", subject: AssumptionSubject, korbly: PositionValuation): RowPreview => {
    const avail = korbly.status === "UNVALUED" ? assumptionAvailability(assetClass, korbly.code) : null;
    let effective: PositionValuation = korbly;
    let assumptionError: string | null = null;
    if (r.asm.kind !== "" && avail?.assumable) {
      const value = r.asm.kind === "PAR" ? null : parseEnteredNumber(r.asm.value);
      if (r.asm.kind !== "PAR" && value === null) assumptionError = r.asm.value.trim() === "" ? "Enter the assumed value." : "Enter the assumption as a number, e.g. 28 for 28%.";
      else {
        const assumed = valueWithAssumption(subject, { kind: r.asm.kind, value, overridesReference: false }, valuationDate);
        if (assumed.status === "VALUED") effective = assumed;
        else assumptionError = assumed.assumptionProblem?.reason ?? assumed.reason;
      }
    }
    return { valuation: effective, korbly, avail, subject, error: null, assumptionError, value: effective.status === "VALUED" ? effective.referenceValueGhs : null };
  };

  const preview = (r: BasketRow): RowPreview => {
    if (r.size.trim() === "") return none;
    const n = parseEnteredNumber(r.size);
    if (r.kind === "BOND") {
      const b = bondById.get(r.instrumentId)!;
      const size = validatePositionDraft({ assetClass: "BOND", nominalGhs: n, currency: "GHS" });
      if (n === null || !size.ok || size.assetClass !== "BOND") return fail(n === null ? "Enter a number, e.g. 2,000,000." : size.ok ? "Invalid amount." : size.error);
      return finalize(r, "BOND", { assetClass: "BOND", nominalGhs: size.nominalGhs, terms: b.terms }, valueBondPosition(size.nominalGhs, b.terms, b.input, valuationDate));
    }
    if (r.kind === "EQUITY") {
      const e = equityById.get(r.instrumentId)!;
      const size = validatePositionDraft({ assetClass: "EQUITY", shares: n, currency: "GHS" });
      if (n === null || !size.ok || size.assetClass !== "EQUITY") return fail(n === null ? "Enter whole shares, e.g. 100,000." : size.ok ? "Invalid shares." : size.error);
      return finalize(r, "EQUITY", { assetClass: "EQUITY", shares: size.shares }, valueEquityPosition(size.shares, e.input));
    }
    const m = parseIsoDate(r.maturityDate);
    if (!m) return fail(r.maturityDate ? "Enter a valid maturity date." : "Enter the maturity date.");
    const terms = validateBillTerms({ tenorDays: r.tenorDays, maturityDate: m, currency: "GHS", isin: null });
    if (!terms.ok) return fail(terms.error);
    const issued = checkBillIssued(terms.terms, valuationDate);
    if (!issued.ok) return fail(issued.error);
    const addable = checkBillAddable({ currency: "GHS", maturityDate: m }, valuationDate);
    if (!addable.addable) return fail(addable.reason);
    const size = validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: n, currency: "GHS" });
    if (n === null || !size.ok || size.assetClass !== "TREASURY_BILL") return fail(n === null ? "Enter a number, e.g. 1,000,000." : size.ok ? "Invalid amount." : size.error);
    const input = resolveBillValuationInput({ currency: "GHS", tenorDays: terms.terms.tenorDays, issueDate: terms.terms.issueDate, maturityDate: m, curve }, valuationDate);
    return finalize(r, "TREASURY_BILL", { assetClass: "TREASURY_BILL", faceValueGhs: size.faceValueGhs, daysToMaturity: billDaysToMaturity(m, valuationDate) }, valueBillPosition(size.faceValueGhs, input, valuationDate));
  };

  const previews = rows.map((r) => ({ r, p: preview(r) }));
  // A chosen assumption that cannot be applied blocks the save (it is never silently dropped); "leave unvalued" is always allowed.
  const ready = rows.length > 0 && previews.every(({ p }) => p.error === null && p.assumptionError === null && p.valuation !== null);
  const basketValue = previews.reduce((s, { p }) => s + (p.value ?? 0), 0);
  const valuedRows = previews.flatMap(({ p }) => (p.valuation ? [p.valuation] : []));
  const basketSummary = valuedRows.length === 0 ? null : summarizePortfolio(valuedRows, valuationDate);
  const rowErrorFor = (key: string) => state.rowErrors?.find((e) => e.key === key)?.error;
  const payload = JSON.stringify(
    rows.map((r) => {
      // Only a deliberately chosen assumption on a row Korbly cannot value is sent; nothing is ever assumed by default.
      const asm = previews.find((x) => x.r.key === r.key)?.p.avail?.assumable && r.asm.kind !== "" ? { assumption: { kind: r.asm.kind, value: r.asm.kind === "PAR" ? "" : r.asm.value } } : {};
      return r.kind === "BOND" ? { key: r.key, assetClass: "BOND", instrumentId: r.instrumentId, nominalGhs: r.size, ...asm } : r.kind === "EQUITY" ? { key: r.key, assetClass: "EQUITY", instrumentId: r.instrumentId, shares: r.size, ...asm } : { key: r.key, assetClass: "TREASURY_BILL", tenorDays: r.tenorDays, maturityDate: r.maturityDate, faceValueGhs: r.size, ...asm };
    }),
  );

  const rowLabel = (r: BasketRow) => (r.kind === "BOND" ? bondById.get(r.instrumentId)!.label : r.kind === "EQUITY" ? equityById.get(r.instrumentId)!.ticker : `${r.tenorDays}-day Treasury bill`);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2.4fr)]">
      {/* ---------------- Browse ---------------- */}
      <section aria-label="Browse instruments" className="min-w-0">
        <div role="tablist" aria-label="Asset class" className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${FOCUS} ${tab === t.id ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"}`}>
              {t.label}
              {counts[t.id] > 0 && <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] text-white">{counts[t.id]}</span>}
            </button>
          ))}
        </div>

        {tab !== "TREASURY_BILL" && (
          <>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "EQUITY" ? "Search ticker or company" : "Search issuer, maturity or code"} aria-label="Search instruments" className={`mt-3 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 ${FOCUS}`} />
            {blockedHere > 0 && (
              <label className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
                Show {blockedHere} that cannot be added (matured, floating-rate, non-GHS, inactive)
              </label>
            )}
            <ul className="mt-3 max-h-[30rem] divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label={`${TABS.find((t) => t.id === tab)!.label} available to add`}>
              {bondList.length + equityList.length === 0 && <li className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">No instruments match.</li>}
              {bondList.map((b) => (
                <PickRow key={b.id} checked={selectedKeys.has(bondKey(b.id))} heldId={held[bondKey(b.id)]} portfolioId={portfolioId} disabledReason={b.addable.addable ? null : b.addable.reason} onToggle={() => toggle({ key: bondKey(b.id), kind: "BOND", instrumentId: b.id })} badge={<AssetBadge assetClass="BOND" classification={b.instrumentType} />} title={b.label} sub={`${b.issuerName} · ${b.couponRatePct !== null ? `${b.couponRatePct.toFixed(2)}% coupon` : "zero coupon"} · matures ${formatIsoDate(b.maturityDate)}`}>
                  {b.input.available ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Yield {formatPct(b.input.observedYtmPct)} · {ageText(b.input.ageDays)} <RecencyBadge recency={b.input.recency} />
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">No reliable Reference Value — {UNVALUED_LABEL[b.input.code].toLowerCase()}. {assumptionAvailability("BOND", b.input.code).assumable ? "You can add it with a valuation assumption, or leave it unvalued." : "Cannot be modelled: its contract terms are incomplete or in conflict."}</span>
                  )}
                </PickRow>
              ))}
              {equityList.map((e) => (
                <PickRow key={e.id} checked={selectedKeys.has(equityKey(e.id))} heldId={held[equityKey(e.id)]} portfolioId={portfolioId} disabledReason={e.addable.addable ? null : e.addable.reason} onToggle={() => toggle({ key: equityKey(e.id), kind: "EQUITY", instrumentId: e.id })} badge={<AssetBadge assetClass="EQUITY" />} title={e.ticker} sub={e.companyName}>
                  {e.input.available ? (
                    <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      Last traded GHS {e.input.priceGhs.toFixed(4)} · {ageText(e.input.ageDays)} <RecencyBadge recency={e.input.recency} />
                    </span>
                  ) : (
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">No reliable Reference Value — {UNVALUED_LABEL[e.input.code].toLowerCase()}. {assumptionAvailability("EQUITY", e.input.code).assumable ? "You can add it with a price assumption, or leave it unvalued." : "Cannot be modelled."}</span>
                  )}
                </PickRow>
              ))}
            </ul>
          </>
        )}

        {tab === "TREASURY_BILL" && (
          <div className="mt-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Add a Treasury bill</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Bills are described the way you know them — original tenor, maturity date and face amount. Choose a tenor to add a row to your selection; you can add several bills.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {BILL_TENORS.map((t) => (
                <button key={t} type="button" onClick={() => addBill(t)} className={`rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 hover:border-blue-500 hover:text-blue-700 dark:border-zinc-700 dark:text-zinc-200 dark:hover:text-blue-300 ${FOCUS}`}>
                  + {t}-day bill
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">Valued from the latest Bank of Ghana auction curve{curve ? ` (${formatIsoDate(curve.observationDate)})` : ""} — an indicative valuation; no secondary-market quote is available.</p>
          </div>
        )}
      </section>

      {/* ---------------- Basket ---------------- */}
      <form action={formAction} className="min-w-0 lg:sticky lg:top-0 lg:self-start" aria-label="Selected instruments">
        <input type="hidden" name="entries" value={payload} />
        <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-baseline justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your selection <span className="ml-1 font-normal text-zinc-500">({rows.length})</span></h2>
            {rows.length > 0 && (
              <button type="button" onClick={() => setRows([])} className={`text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 ${FOCUS}`}>
                Clear all
              </button>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Tick instruments on the left. Each one appears here, where you enter how much you hold.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {previews.map(({ r, p }) => {
                const serverErr = rowErrorFor(r.key);
                const name = rowLabel(r);
                const dup = r.kind === "TREASURY_BILL" && r.maturityDate && (held[heldBillKey(r.tenorDays, r.maturityDate)] || rows.some((o) => o.key !== r.key && o.kind === "TREASURY_BILL" && o.tenorDays === r.tenorDays && o.maturityDate === r.maturityDate));
                return (
                  <li key={r.key} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          {r.kind === "BOND" ? <AssetBadge assetClass="BOND" classification={bondById.get(r.instrumentId)!.instrumentType} /> : <AssetBadge assetClass={r.kind} />}
                          {name}
                        </p>
                        {r.kind === "BOND" && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{bondById.get(r.instrumentId)!.issuerName}</p>}
                        {r.kind === "EQUITY" && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{equityById.get(r.instrumentId)!.companyName}</p>}
                      </div>
                      <button type="button" onClick={() => remove(r.key)} aria-label={`Remove ${name} from selection`} className={`rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${FOCUS}`}>
                        Remove
                      </button>
                    </div>
                    {r.kind === "TREASURY_BILL" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                          Original tenor
                          <select value={r.tenorDays} onChange={(e) => update(r.key, { tenorDays: Number(e.target.value) })} aria-label={`Original tenor for ${name}`} className={`${INPUT} mt-0.5`}>
                            {BILL_TENORS.map((t) => (
                              <option key={t} value={t}>
                                {t}-day bill
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                          Maturity date
                          <input type="date" value={r.maturityDate} onChange={(e) => update(r.key, { maturityDate: e.target.value })} aria-label={`Maturity date for ${name}`} className={`${INPUT} mt-0.5`} />
                        </label>
                      </div>
                    )}
                    <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                      {r.kind === "EQUITY" ? "Shares held" : r.kind === "BOND" ? "Nominal held (GHS)" : "Face amount at maturity (GHS)"}
                      <input value={r.size} onChange={(e) => update(r.key, { size: e.target.value })} inputMode={r.kind === "EQUITY" ? "numeric" : "decimal"} autoComplete="off" placeholder={r.kind === "EQUITY" ? "100,000" : r.kind === "BOND" ? "1,000,000" : "1,000,000"} aria-label={`${r.kind === "EQUITY" ? "Shares" : r.kind === "BOND" ? "Nominal in GHS" : "Face amount in GHS"} for ${name}`} className={`${INPUT} mt-0.5`} />
                    </label>
                    {p.korbly?.status === "UNVALUED" && p.avail?.assumable && (
                      <div className="rounded border border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-500/40 dark:bg-amber-400/5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">No reliable Reference Value</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-zinc-700 dark:text-zinc-300">Korbly does not have enough market evidence to value this. Leave it unvalued, or provide an assumption so it can join the analysis.</p>
                        <label className="mt-2 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                          What to assume
                          <select value={r.asm.kind} onChange={(e) => update(r.key, { asm: { kind: e.target.value as AssumptionKind | "", value: "" } })} aria-label={`Valuation assumption for ${name}`} className={`${INPUT} mt-0.5`}>
                            <option value="">Nothing — leave it unvalued</option>
                            {p.avail.kinds.map((k) => (
                              <option key={k} value={k}>{ASSUMPTION_KIND_LABEL[k]}</option>
                            ))}
                          </select>
                        </label>
                        {r.asm.kind !== "" && (
                          <>
                            <p className="mt-1 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">{ASSUMPTION_HELP[r.asm.kind][r.kind === "BOND" ? "bond" : r.kind === "TREASURY_BILL" ? "bill" : "equity"]}</p>
                            {r.asm.kind !== "PAR" && (
                              <label className="mt-1.5 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                                Assumed value <span className="font-normal">({ASSUMPTION_UNIT[r.asm.kind]})</span>
                                <input value={r.asm.value} onChange={(e) => update(r.key, { asm: { kind: r.asm.kind, value: e.target.value } })} inputMode="decimal" autoComplete="off" placeholder={r.asm.kind === "YIELD_PCT" || r.asm.kind === "RATE_PCT" ? "28" : r.asm.kind === "PRICE_PER_100" ? "85" : "12.50"} aria-label={`Assumed value for ${name}`} className={`${INPUT} mt-0.5 max-w-[10rem]`} />
                              </label>
                            )}
                            <p className="mt-1.5 text-[11px] font-medium text-indigo-900 dark:text-indigo-200">{ASSUMPTION_DISCLOSURE}</p>
                          </>
                        )}
                      </div>
                    )}
                    <div aria-live="polite" className="min-h-4 text-xs">
                      {p.error && <p className="text-red-600 dark:text-red-400">{p.error}</p>}
                      {dup && <p className="text-red-600 dark:text-red-400">{held[heldBillKey(r.tenorDays, r.maturityDate)] ? "Already in this portfolio." : "Selected more than once."}</p>}
                      {p.valuation?.status === "VALUED" && (
                        <p className="flex flex-wrap items-center gap-x-1.5 text-zinc-700 dark:text-zinc-300">
                          <BasisBadge basis={p.valuation.basis} detail={p.valuation.assumption?.summary ?? null} />
                          {p.valuation.basis === "ANALYST_ASSUMPTION" ? "Assumption value" : p.valuation.basis === "INDICATIVE" ? "Indicative value" : "Reference value"} <span className="font-semibold tabular-nums">{formatGhs(p.valuation.referenceValueGhs)}</span>
                          {p.valuation.recency === "STALE" && <span className="text-amber-700 dark:text-amber-400">· older evidence</span>}
                        </p>
                      )}
                      {p.valuation?.status === "UNVALUED" && p.korbly?.status === "UNVALUED" && p.avail && !p.avail.assumable && (
                        <p className="text-amber-700 dark:text-amber-400"><BasisBadge basis="UNVALUED" /> Cannot be modelled — {p.avail.reason} It will be recorded but not valued.</p>
                      )}
                      {p.valuation?.status === "UNVALUED" && !(p.avail && !p.avail.assumable) && p.assumptionError === null && <p className="text-amber-700 dark:text-amber-400"><BasisBadge basis="UNVALUED" /> Will be recorded, unvalued and excluded from totals — not counted as zero.</p>}
                      {p.assumptionError && <p role="alert" className="text-red-600 dark:text-red-400">{p.assumptionError}</p>}
                      {serverErr && (
                        <p role="alert" className="text-red-600 dark:text-red-400">
                          {serverErr}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="space-y-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
            {rows.length > 0 && (
              <p className="flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
                <span>{basketSummary && basketSummary.assumptionCount > 0 ? "Analytical Starting Value of valued rows" : "Reference value of valued rows"}</span>
                <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatGhs(basketValue)}</span>
              </p>
            )}
            {basketSummary && basketSummary.assumptionCount > 0 && <ValuationBasisBar summary={basketSummary} compact heading={false} />}
            {state.error && (
              <p role="alert" className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
                {state.error}
              </p>
            )}
            <button type="submit" disabled={!ready || pending} className={`w-full rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${FOCUS}`}>
              {pending ? "Adding…" : rows.length === 0 ? "Add to portfolio" : `Add ${rows.length} ${rows.length === 1 ? "position" : "positions"} to portfolio`}
            </button>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">All positions are added together, or none are. Fill in every row to enable the button.</p>
            <Link href={`/portfolios/${portfolioId}`} className={`inline-block text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 ${FOCUS}`}>
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}

function PickRow({ checked, heldId, portfolioId, disabledReason, onToggle, badge, title, sub, children }: { checked: boolean; heldId?: string; portfolioId: string; disabledReason: string | null; onToggle: () => void; badge: React.ReactNode; title: string; sub: string; children: React.ReactNode }) {
  const body = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="flex flex-wrap items-center gap-1.5">
        {badge}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        {heldId && <span className="rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">In portfolio</span>}
      </span>
      <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</span>
      {disabledReason ? <span className="text-[11px] text-red-700 dark:text-red-400">Cannot be added — {disabledReason}</span> : children}
    </span>
  );
  const base = `flex w-full items-start gap-3 px-3 py-2.5 ${checked ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`;
  return (
    <li>
      {heldId ? (
        <Link href={`/portfolios/${portfolioId}?view=holdings&position=${heldId}&duplicate=1#inspect`} className={`${base} ${FOCUS}`} title="Already in this portfolio — edit the existing position">
          <span className="mt-0.5 size-4 shrink-0 rounded border border-dashed border-zinc-300 dark:border-zinc-600" aria-hidden />
          {body}
        </Link>
      ) : (
        <button type="button" role="checkbox" aria-checked={checked} disabled={disabledReason !== null} onClick={onToggle} className={`${base} ${FOCUS} disabled:cursor-not-allowed disabled:opacity-60`}>
          <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${checked ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-400 dark:border-zinc-500"}`} aria-hidden>
            {checked ? "✓" : ""}
          </span>
          {body}
        </button>
      )}
    </li>
  );
}
