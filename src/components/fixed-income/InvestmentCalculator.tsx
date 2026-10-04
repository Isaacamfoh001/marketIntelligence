"use client";

// ---------------------------------------------------------------------------
// Investment / Return Calculator (M7 §15) — hold-to-maturity scenario.
// Pure client-side computation: evaluateInvestment is a pure function with
// no I/O, so no server round-trip is needed as the user adjusts the amount
// or price (CLAUDE.md §19: financial calculations live in reusable
// domain functions, never duplicated — this calls the exact same function
// the server-rendered analytics elsewhere on this page are built from).
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { evaluateInvestment, type BondTerms } from "@/lib/fixed-income";

function formatGhs(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function InvestmentCalculator({
  terms,
  settlementDateIso,
  defaultPrice,
}: {
  terms: BondTerms;
  settlementDateIso: string;
  defaultPrice: number | null;
}) {
  const [amount, setAmount] = useState("1000000");
  const [price, setPrice] = useState(defaultPrice !== null ? defaultPrice.toString() : "");

  const settlementDate = useMemo(() => new Date(`${settlementDateIso}T00:00:00.000Z`), [settlementDateIso]);

  const result = useMemo(() => {
    const amountNum = Number(amount);
    const priceNum = Number(price);
    if (!Number.isFinite(amountNum) || !Number.isFinite(priceNum)) return null;
    return evaluateInvestment(terms, settlementDate, amountNum, priceNum);
  }, [terms, settlementDate, amount, price]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Investment Amount (GHS)</span>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Purchase Price (clean, per 100 face)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
      </div>

      {!result ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Enter a positive investment amount and price.</p>
      ) : !result.ok ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">{result.message}</p>
      ) : (
        <div className="rounded border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Face Value Acquired</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{formatGhs(result.faceValueAcquired)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Accrued Interest</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{formatGhs(result.accruedInterest)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total Coupons (to maturity)</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{formatGhs(result.totalCouponsReceived)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Principal Redemption</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{formatGhs(result.principalRedemption)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total Nominal Cash Received</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{formatGhs(result.totalNominalCashReceived)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Nominal Profit</div>
              <div className={`mt-1 text-lg font-semibold ${result.nominalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {formatGhs(result.nominalProfit)}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Annualised Return (YTM)</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{result.annualisedReturnPct.toFixed(2)}%</div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-zinc-400 dark:text-zinc-500">
            Assumes the bond is held to maturity and every coupon is received on schedule at face value — not a guaranteed return. Nominal figures are not
            discounted for the time value of money; the annualised figure (YTM) already accounts for timing.
          </p>
        </div>
      )}
    </div>
  );
}
