"use client";

// ---------------------------------------------------------------------------
// Dealer Quote / Investment Calculator (M7 §15, upgraded in M7.3 §13).
// Pure client-side computation: evaluateInvestment is a pure function with
// no I/O, so no server round-trip is needed as the analyst types a dealer
// quote (CLAUDE.md §19: financial calculations live in reusable domain
// functions — this calls the same engine as every other figure on the page).
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { evaluateInvestment, formatGhs, formatIsoDate, formatPct, GFIM_BOND_TRANSACTION_LEVY, type BondTerms } from "@/lib/fixed-income";
import { signedTone } from "./ui";

const INPUT = "mt-1 w-full rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm tabular-nums text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
/** Amounts inside the GHS-labelled boxes — the currency is stated once in each box heading. */
function ghs(value: number): string {
  return value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const LABEL = "text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

function Row({ label, value, sub, strong = false, border = false }: { label: string; value: React.ReactNode; sub?: string; strong?: boolean; border?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1 ${border ? "mt-1 border-t border-zinc-200 pt-2 dark:border-zinc-700" : ""}`}>
      <div className={strong ? "text-sm font-medium text-zinc-900 dark:text-zinc-100" : "text-sm text-zinc-600 dark:text-zinc-400"}>
        {label}
        {sub && <span className="ml-1 text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</span>}
      </div>
      <div className={`whitespace-nowrap tabular-nums ${strong ? "text-sm font-semibold text-zinc-900 dark:text-zinc-100" : "text-sm text-zinc-700 dark:text-zinc-300"}`}>{value}</div>
    </div>
  );
}

export function InvestmentCalculator({
  terms,
  settlementDateIso,
  defaultPrice,
  defaultPriceLabel,
}: {
  terms: BondTerms;
  settlementDateIso: string;
  defaultPrice: number | null;
  /** Says where the pre-filled price came from (e.g. "GFIM secondary trade, 2 Oct 2026") so it is never mistaken for a live dealer quote. */
  defaultPriceLabel: string | null;
}) {
  const [amount, setAmount] = useState("1000000");
  const [price, setPrice] = useState(defaultPrice !== null ? defaultPrice.toString() : "");
  const [dealerFee, setDealerFee] = useState("0");
  const [includeLevy, setIncludeLevy] = useState(true);

  const settlementDate = useMemo(() => new Date(`${settlementDateIso}T00:00:00.000Z`), [settlementDateIso]);

  const result = useMemo(() => {
    if (price.trim() === "") return null;
    const amountNum = Number(amount);
    const priceNum = Number(price);
    const feeNum = dealerFee.trim() === "" ? 0 : Number(dealerFee);
    if (!Number.isFinite(amountNum) || !Number.isFinite(priceNum) || !Number.isFinite(feeNum)) return null;
    return evaluateInvestment(terms, settlementDate, amountNum, priceNum, {
      regulatoryLevyPct: includeLevy ? GFIM_BOND_TRANSACTION_LEVY.ratePct : 0,
      dealerFeePct: feeNum,
    });
  }, [terms, settlementDate, amount, price, dealerFee, includeLevy]);

  const priceIsPrefilled = defaultPrice !== null && Number(price) === defaultPrice;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={LABEL}>Total investment (GHS)</span>
          <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} />
          <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-500">Cash outlay including accrued interest and charges</span>
        </label>
        <label className="block">
          <span className={LABEL}>Dealer clean price (per 100 face)</span>
          <input type="number" min="0" step="0.0001" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Enter dealer quote" className={INPUT} />
          <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-500">
            {priceIsPrefilled && defaultPriceLabel ? `Pre-filled: last observed price (${defaultPriceLabel}) — replace with the dealer's quote` : "Enter the price quoted by the dealer"}
          </span>
        </label>
        <label className="block">
          <span className={LABEL}>Dealer fee (% of consideration)</span>
          <input type="number" min="0" step="0.01" value={dealerFee} onChange={(e) => setDealerFee(e.target.value)} className={INPUT} />
          <span className="mt-0.5 block text-[11px] text-zinc-400 dark:text-zinc-500">0 if the quote is all-in or no fee is known</span>
        </label>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" checked={includeLevy} onChange={(e) => setIncludeLevy(e.target.checked)} />
        Include {GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC bond transaction levy
        <a href={GFIM_BOND_TRANSACTION_LEVY.sourceUrl} target="_blank" rel="noreferrer" className="text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-300" title={GFIM_BOND_TRANSACTION_LEVY.basis}>
          source
        </a>
      </label>

      {!result ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">The return calculator requires a purchase price — enter the dealer&apos;s clean price above.</p>
      ) : !result.ok ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">{result.message}</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <p className={`${LABEL} mb-1`}>Acquisition cost (GHS)</p>
              <Row label="Face value acquired" value={ghs(result.faceValueAcquired)} />
              <Row label="Clean consideration" sub={`@ ${result.cleanPrice.toFixed(4)}`} value={ghs(result.cleanConsideration)} />
              <Row label="+ Accrued interest" sub={`${result.accruedInterest.toFixed(4)} per 100`} value={ghs(result.accruedInterestPaid)} />
              <Row label="= Settlement consideration" value={ghs(result.settlementConsideration)} border />
              <Row label="+ SEC transaction levy" sub={includeLevy ? `${GFIM_BOND_TRANSACTION_LEVY.ratePct}%` : "excluded"} value={ghs(result.regulatoryLevy)} />
              <Row label="+ Dealer fee" value={ghs(result.dealerFee)} />
              <Row label="= Total acquisition cost" value={ghs(result.totalAcquisitionCost)} strong border />
            </div>
            <div className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <p className={`${LABEL} mb-1`}>Expected cash if held to maturity (GHS)</p>
              <Row label="Remaining coupon income" sub={`${result.cashFlows.length} payment${result.cashFlows.length === 1 ? "" : "s"}`} value={ghs(result.totalCouponsReceived)} />
              <Row label="Principal redemption" sub={formatIsoDate(terms.maturityDate.toISOString().slice(0, 10))} value={ghs(result.principalRedemption)} />
              <Row label="= Total cash received" value={ghs(result.totalNominalCashReceived)} strong border />
              <Row label="Nominal profit / loss" value={<span className={signedTone(result.nominalProfit)}>{ghs(result.nominalProfit)}</span>} strong />
            </div>
            <div className="rounded border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
              <p className={`${LABEL} mb-1`}>Annualized hold-to-maturity return</p>
              <div className={`text-3xl font-semibold tabular-nums ${signedTone(result.annualisedReturnPct)}`}>{formatPct(result.annualisedReturnPct)}</div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Gross / pre-tax · after the charges shown · on total acquisition cost</p>
              <div className="mt-3 space-y-0.5 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                <Row label="YTM at dealer price" sub="before charges" value={formatPct(result.ytmBeforeChargesPct)} />
                {result.effectiveAnnualReturnPct !== null && <Row label="Effective annual equivalent" sub="XIRR basis" value={formatPct(result.effectiveAnnualReturnPct)} />}
              </div>
            </div>
          </div>

          <details className="rounded border border-zinc-200 dark:border-zinc-800">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">Expected remaining cash flows for this position ({result.cashFlows.length})</summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <th className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Payment date</th>
                    <th className="px-3 py-1.5 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Coupon</th>
                    <th className="px-3 py-1.5 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Principal</th>
                    <th className="px-3 py-1.5 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cashFlows.map((f) => (
                    <tr key={f.date.toISOString()} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                      <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{formatIsoDate(f.date.toISOString().slice(0, 10))}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{formatGhs(f.coupon)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{f.principal > 0 ? formatGhs(f.principal) : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{formatGhs(f.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Calculated as of {formatIsoDate(settlementDateIso)} (settlement assumed on the valuation date). Assumes the bond is held to maturity and every coupon is paid on
            schedule — not a guaranteed return. Tax is not deducted: withholding treatment depends on the investing entity. Nominal figures are undiscounted; the annualized
            figure accounts for timing.
          </p>
        </div>
      )}
    </div>
  );
}
