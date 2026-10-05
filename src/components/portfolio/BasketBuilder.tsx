"use client";

// ---------------------------------------------------------------------------
// Portfolio builder (M9.0): search and browse Ghanaian instruments by asset
// class, tick several, review the selected basket, enter each position in ITS
// OWN terms (bond nominal GHS · equity whole shares · Treasury bill tenor +
// maturity + face), see each row's reference value before saving, then add
// everything in one step. All-or-nothing: if any row is invalid nothing is
// saved and every problem is shown against its row.
//
// Validation and valuation are the pure domain functions; this component only
// wires them to inputs. The server re-validates every row.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { BILL_TENORS, checkBillIssued, parseIsoDate, validateBillTerms, type AuctionCurve } from "@/lib/treasury-bills";
import { bondKey, checkBillAddable, equityKey, filterBonds, filterEquities, heldBillKey, parseEnteredNumber, removeBasketRow, toggleBasketRow, resolveBillValuationInput, UNVALUED_LABEL, validatePositionDraft, valueBillPosition, valueBondPosition, valueEquityPosition, type PositionValuation } from "@/lib/portfolio";
import { formatGhs, formatIsoDate, formatPct } from "@/lib/fixed-income";
import type { BondInstrument, EquityInstrument } from "@/lib/queries/portfolio";
import type { BatchFormState } from "@/app/portfolios/actions";
import { AssetBadge, ageText, RecencyBadge } from "./ui";

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

  const toggle = (row: Omit<BasketRow, "size" | "tenorDays" | "maturityDate">) => setRows((cur) => toggleBasketRow(cur, { ...row, size: "", tenorDays: 91, maturityDate: "" }));
  const update = (key: string, patch: Partial<BasketRow>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => setRows((cur) => removeBasketRow(cur, key));
  const addBill = (tenorDays: number) => {
    setRows((cur) => [...cur, { key: `BILL#${billSeq}`, kind: "TREASURY_BILL", instrumentId: "", size: "", tenorDays, maturityDate: "" }]);
    setBillSeq((n) => n + 1);
  };

  const preview = (r: BasketRow): { valuation: PositionValuation | null; error: string | null; value: number | null } => {
    if (r.size.trim() === "") return { valuation: null, error: null, value: null };
    const n = parseEnteredNumber(r.size);
    if (r.kind === "BOND") {
      const b = bondById.get(r.instrumentId)!;
      const size = validatePositionDraft({ assetClass: "BOND", nominalGhs: n, currency: "GHS" });
      if (n === null || !size.ok || size.assetClass !== "BOND") return { valuation: null, error: n === null ? "Enter a number, e.g. 2,000,000." : size.ok ? "Invalid amount." : size.error, value: null };
      const v = valueBondPosition(size.nominalGhs, b.terms, b.input, valuationDate);
      return { valuation: v, error: null, value: v.status === "VALUED" ? v.referenceValueGhs : null };
    }
    if (r.kind === "EQUITY") {
      const e = equityById.get(r.instrumentId)!;
      const size = validatePositionDraft({ assetClass: "EQUITY", shares: n, currency: "GHS" });
      if (n === null || !size.ok || size.assetClass !== "EQUITY") return { valuation: null, error: n === null ? "Enter whole shares, e.g. 100,000." : size.ok ? "Invalid shares." : size.error, value: null };
      const v = valueEquityPosition(size.shares, e.input);
      return { valuation: v, error: null, value: v.status === "VALUED" ? v.referenceValueGhs : null };
    }
    const m = parseIsoDate(r.maturityDate);
    if (!m) return { valuation: null, error: r.maturityDate ? "Enter a valid maturity date." : "Enter the maturity date.", value: null };
    const terms = validateBillTerms({ tenorDays: r.tenorDays, maturityDate: m, currency: "GHS", isin: null });
    if (!terms.ok) return { valuation: null, error: terms.error, value: null };
    const issued = checkBillIssued(terms.terms, valuationDate);
    if (!issued.ok) return { valuation: null, error: issued.error, value: null };
    const addable = checkBillAddable({ currency: "GHS", maturityDate: m }, valuationDate);
    if (!addable.addable) return { valuation: null, error: addable.reason, value: null };
    const size = validatePositionDraft({ assetClass: "TREASURY_BILL", nominalGhs: n, currency: "GHS" });
    if (n === null || !size.ok || size.assetClass !== "TREASURY_BILL") return { valuation: null, error: n === null ? "Enter a number, e.g. 1,000,000." : size.ok ? "Invalid amount." : size.error, value: null };
    const input = resolveBillValuationInput({ currency: "GHS", tenorDays: terms.terms.tenorDays, issueDate: terms.terms.issueDate, maturityDate: m, curve }, valuationDate);
    const v = valueBillPosition(size.faceValueGhs, input, valuationDate);
    return { valuation: v, error: null, value: v.status === "VALUED" ? v.referenceValueGhs : null };
  };

  const previews = rows.map((r) => ({ r, p: preview(r) }));
  const ready = rows.length > 0 && previews.every(({ p }) => p.error === null && p.valuation !== null);
  const basketValue = previews.reduce((s, { p }) => s + (p.value ?? 0), 0);
  const rowErrorFor = (key: string) => state.rowErrors?.find((e) => e.key === key)?.error;
  const payload = JSON.stringify(rows.map((r) => (r.kind === "BOND" ? { key: r.key, assetClass: "BOND", instrumentId: r.instrumentId, nominalGhs: r.size } : r.kind === "EQUITY" ? { key: r.key, assetClass: "EQUITY", instrumentId: r.instrumentId, shares: r.size } : { key: r.key, assetClass: "TREASURY_BILL", tenorDays: r.tenorDays, maturityDate: r.maturityDate, faceValueGhs: r.size })));

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
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">Can be recorded, not valued today — {UNVALUED_LABEL[b.input.code].toLowerCase()}</span>
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
                    <span className="text-[11px] text-amber-700 dark:text-amber-400">Can be recorded, not valued today — {UNVALUED_LABEL[e.input.code].toLowerCase()}</span>
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
                    <div aria-live="polite" className="min-h-4 text-xs">
                      {p.error && <p className="text-red-600 dark:text-red-400">{p.error}</p>}
                      {dup && <p className="text-red-600 dark:text-red-400">{held[heldBillKey(r.tenorDays, r.maturityDate)] ? "Already in this portfolio." : "Selected more than once."}</p>}
                      {p.valuation?.status === "VALUED" && (
                        <p className="text-zinc-700 dark:text-zinc-300">
                          Reference value <span className="font-semibold tabular-nums">{formatGhs(p.valuation.referenceValueGhs)}</span>
                          {p.valuation.recency === "STALE" && <span className="ml-1.5 text-amber-700 dark:text-amber-400">· older evidence</span>}
                        </p>
                      )}
                      {p.valuation?.status === "UNVALUED" && <p className="text-amber-700 dark:text-amber-400">Will be recorded but not valued: {p.valuation.reason}</p>}
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
                <span>Reference value of valued rows</span>
                <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatGhs(basketValue)}</span>
              </p>
            )}
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
