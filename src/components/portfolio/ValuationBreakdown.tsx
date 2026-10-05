// ---------------------------------------------------------------------------
// The calculation behind one position's reference value, laid out so nothing is
// mysterious (M8.1 §17): every input, its date and age, the formula with the
// actual numbers, and the assumption it rests on. Pure presentation of a
// PositionValuation produced by the domain layer — it computes nothing, so the
// same component serves the saved-position drill-down and the live preview in
// the add/edit form.
// ---------------------------------------------------------------------------

import { ASSUMPTION_DISCLOSURE, BILL_ASSUMPTION, BILL_BASIS_LABEL, BOND_ASSUMPTION, RECENCY_LABEL, RECENCY_RULE, type InputRecency, type PositionValuation, type ValuedPosition } from "@/lib/portfolio";
import { formatGhs, formatIsoDate, formatPct } from "@/lib/fixed-income";
import { ageText, formatInt, formatPrice, RecencyBadge } from "./ui";
import { BasisBadge } from "./basis";

function Row({ label, value, sub, strong = false }: { label: string; value: React.ReactNode; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "text-sm font-semibold text-zinc-900 dark:text-zinc-100" : "text-sm text-zinc-800 dark:text-zinc-200"}`}>
        {value}
        {sub && <div className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">{sub}</div>}
      </dd>
    </div>
  );
}

/** A value that rests on an analyst assumption: the assumption first, then the arithmetic, never dressed up as an observation. */
function AssumptionBreakdown({ valuation }: { valuation: ValuedPosition }) {
  const a = valuation.assumption!;
  const d = valuation.detail;
  const k = valuation.korblyBasis;
  const delta = k ? (valuation.referenceValueGhs ?? 0) - (k.valueGhs ?? 0) : 0;
  return (
    <div>
      {k && (
        <div className="mb-2 grid gap-2 sm:grid-cols-2" role="group" aria-label="Reference basis compared with analytical basis">
          <div className="rounded border border-zinc-200 bg-zinc-50 px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Reference basis · Korbly</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatGhs(k.valueGhs)}</p>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">Korbly {k.basis === "REFERENCE" ? "Reference" : "Indicative"} value — unchanged{k.inputDate ? `, input of ${formatIsoDate(k.inputDate)}` : ""}</p>
          </div>
          <div className="rounded border border-indigo-200 bg-indigo-50/60 px-2.5 py-2 dark:border-indigo-400/30 dark:bg-indigo-400/10">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-300">Analytical basis · your override</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-indigo-950 dark:text-indigo-100">{formatGhs(valuation.referenceValueGhs)}</p>
            <p className="text-[11px] text-indigo-900 dark:text-indigo-200">Used in this analysis · {delta >= 0 ? "+" : "−"}{formatGhs(Math.abs(delta))} vs Korbly</p>
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 sm:col-span-2">You deliberately chose to test a different starting basis. It does not replace Korbly’s value, which stays as shown.</p>
        </div>
      )}
      <div className="rounded border border-indigo-200 bg-indigo-50/60 px-2.5 py-2 dark:border-indigo-400/30 dark:bg-indigo-400/10">
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-indigo-950 dark:text-indigo-100">
          <BasisBadge basis="ANALYST_ASSUMPTION" /> {a.summary}
        </p>
        <p className="mt-1 text-xs text-indigo-900 dark:text-indigo-200">{ASSUMPTION_DISCLOSURE}</p>
      </div>
      <dl className="mt-2">
        {d.assetClass === "BOND" && (
          <>
            <Row label="Nominal" value={formatGhs(d.nominalGhs)} />
            <Row label="Starting yield" value={formatPct(d.observedYtmPct)} sub={a.kind === "YIELD_PCT" ? "the yield you assumed" : "implied by the price you assumed"} />
            <Row label="Valuation date" value={formatIsoDate(d.valuationDate)} />
            <Row label="Clean price" value={formatPrice(d.referenceCleanPrice)} sub={a.kind === "YIELD_PCT" ? `implied by the assumed yield, per ${d.faceValue} face` : a.kind === "PAR" ? "par — assumed" : "the price you assumed"} />
            <Row label="Accrued interest" value={formatPrice(d.accruedInterest)} sub={`per ${d.faceValue} face, at the valuation date`} />
            <Row label="Dirty price" value={formatPrice(d.referenceDirtyPrice)} sub="clean + accrued" />
          </>
        )}
        {d.assetClass === "TREASURY_BILL" && (
          <>
            <Row label="Face (maturity) value" value={formatGhs(d.faceValueGhs)} sub="what the government pays at maturity" />
            <Row label="Days to maturity" value={String(d.daysToMaturity)} sub={`as at ${formatIsoDate(d.valuationDate)}`} />
            <Row label="Starting rate" value={formatPct(d.referenceRatePct, 4)} sub={a.kind === "RATE_PCT" ? "the rate you assumed" : "implied by the price you assumed"} />
            <Row label="Price" value={formatPrice(d.referencePricePer100)} sub="per 100 of face" />
          </>
        )}
        {d.assetClass === "EQUITY" && (
          <>
            <Row label="Shares" value={formatInt(d.shares)} />
            <Row label="Assumed price" value={`GHS ${formatPrice(d.priceGhs)}`} sub="per share — not a GSE trade" />
          </>
        )}
        <Row label="Assumption value" value={formatGhs(valuation.referenceValueGhs)} strong />
      </dl>
      <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer select-none">How this was calculated</summary>
        <p className="mt-1">{a.method}</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 tabular-nums">
          {a.calculation.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Provenance: {a.provenance}. No analyst identity is recorded yet.</p>
      </details>
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">An assumption is a disclosed analytical input. It has no observation date, so it is neither “recent” nor “stale”.</p>
    </div>
  );
}

export function ValuationBreakdown({ valuation }: { valuation: PositionValuation }) {
  if (valuation.status !== "VALUED") {
    return (
      <div className="text-sm text-zinc-700 dark:text-zinc-300">
        <p className="flex items-center gap-2 font-medium">Cannot be valued today <BasisBadge basis="UNVALUED" /></p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">{valuation.reason}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">It is kept in the portfolio and counted as not valued — it is not treated as zero.</p>
        {valuation.assumptionProblem && <p role="alert" className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">The stored assumption ({valuation.assumptionProblem.summary}) could not be applied: {valuation.assumptionProblem.reason}</p>}
      </div>
    );
  }
  if (valuation.basis === "ANALYST_ASSUMPTION" && valuation.assumption) return <AssumptionBreakdown valuation={valuation} />;
  const recency: InputRecency = valuation.recency === "STALE" ? "STALE" : "RECENT";

  const detail = valuation.detail;
  const ignored = valuation.ignoredAssumption && (
    <p className="mb-2 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
      <span className="mr-1.5 rounded border border-zinc-400 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide dark:border-zinc-500">Not currently in use</span>
      A stored analyst assumption ({valuation.ignoredAssumption.summary}) is kept but <span className="font-medium">not applied</span>: Korbly now has its own supported value, which an assumption never silently replaces. Remove the assumption, or re-enter it to override deliberately.
    </p>
  );
  if (detail.assetClass === "BOND") {
    return (
      <div>
        {ignored}
        <dl>
          <Row label="Nominal" value={formatGhs(detail.nominalGhs)} />
          <Row label="Observed yield" value={formatPct(detail.observedYtmPct)} sub={detail.yieldFromSourceQuote ? "source-quoted yield (no price published)" : "solved from the traded price at its own date"} />
          <Row label="Observed on" value={formatIsoDate(detail.observationDate)} sub={ageText(detail.ageDays)} />
          <Row label="Input state" value={<span className="inline-flex items-center gap-1.5">{RECENCY_LABEL[recency]} <RecencyBadge recency={recency} /></span>} />
          <Row label="Valuation date" value={formatIsoDate(detail.valuationDate)} />
          <Row label="Observed clean price" value={detail.observedCleanPrice === null ? "—" : formatPrice(detail.observedCleanPrice)} sub={`historical, as traded on ${formatIsoDate(detail.observationDate)}`} />
          <Row label="Reference clean price" value={formatPrice(detail.referenceCleanPrice)} sub={`rolled to ${formatIsoDate(detail.valuationDate)} at the observed yield`} />
          <Row label="Accrued interest" value={formatPrice(detail.accruedInterest)} sub={`per ${detail.faceValue} face, at the valuation date`} />
          <Row label="Reference dirty price" value={formatPrice(detail.referenceDirtyPrice)} sub="clean + accrued" />
          <Row label="Reference value" value={formatGhs(valuation.referenceValueGhs)} strong />
        </dl>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Reference value = nominal × reference dirty price ÷ face value = {formatInt(detail.nominalGhs)} × {formatPrice(detail.referenceDirtyPrice)} ÷ {detail.faceValue}
        </p>
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="font-medium">Assumption: </span>
          {BOND_ASSUMPTION(formatIsoDate(detail.observationDate), formatIsoDate(detail.valuationDate))}
        </p>
        {detail.pendingReview && (
          <p className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
            <span className="font-medium">A newer observation ({formatIsoDate(detail.pendingReview.date)}) is {detail.pendingReview.status === "REVIEW" ? "pending data-quality review" : "excluded"} and is not used.</span> This value rests on the earlier reliable trade above.
            {detail.pendingReview.issues.length > 0 && <span className="block text-zinc-500 dark:text-zinc-400">{detail.pendingReview.issues.join(" ")}</span>}
          </p>
        )}
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">{RECENCY_RULE.BOND}</p>
      </div>
    );
  }

  if (detail.assetClass === "TREASURY_BILL") {
    return (
      <div>
        {ignored}
        <dl>
          <Row label="Face (maturity) value" value={formatGhs(detail.faceValueGhs)} sub="what the government pays at maturity" />
          <Row label="Days to maturity" value={String(detail.daysToMaturity)} sub={`as at ${formatIsoDate(detail.valuationDate)}`} />
          <Row label="Reference basis" value={BILL_BASIS_LABEL} sub={detail.methodDescription} />
          <Row label="Reference rate" value={formatPct(detail.referenceRatePct, 4)} sub={`auction curve of ${formatIsoDate(detail.rateObservationDate)} · ${ageText(detail.ageDays)}`} />
          <Row label="Input state" value={<span className="inline-flex items-center gap-1.5">{RECENCY_LABEL[recency]} <RecencyBadge recency={recency} /></span>} />
          <Row label="Reference price" value={formatPrice(detail.referencePricePer100)} sub="per 100 of face" />
          <Row label="Discount still to accrue" value={formatGhs(detail.remainingDiscountGhs)} sub="face value − reference value" />
          <Row label="Reference value" value={formatGhs(valuation.referenceValueGhs)} strong />
        </dl>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {detail.convention}: reference value = face ÷ (1 + rate × days ÷ 365) = {formatInt(detail.faceValueGhs)} ÷ (1 + {(detail.referenceRatePct / 100).toFixed(6)} × {detail.daysToMaturity} ÷ 365)
        </p>
        <details className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer select-none">Sensitivity to the Treasury-bill rate</summary>
          <dl className="mt-1">
            <Row label="DV01" value={`${formatGhs(detail.dv01Ghs)} per bp`} sub="value change for a 1bp rise in the bill rate" />
            <Row label="Modified duration" value={`${detail.modifiedDurationYears.toFixed(4)} years`} />
          </dl>
        </details>
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
          <span className="font-medium">Assumption: </span>
          {BILL_ASSUMPTION(formatIsoDate(detail.rateObservationDate), formatIsoDate(detail.valuationDate))}
        </p>
        <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">{RECENCY_RULE.TREASURY_BILL}</p>
      </div>
    );
  }

  return (
    <div>
      {ignored}
      <dl>
        <Row label="Shares" value={formatInt(detail.shares)} />
        <Row label="Last traded price" value={`GHS ${formatPrice(detail.priceGhs)}`} sub="GSE closing price (VWAP) on the last day shares actually traded" />
        <Row label="Trade date" value={formatIsoDate(detail.priceDate)} sub={ageText(detail.ageDays)} />
        <Row label="Input state" value={<span className="inline-flex items-center gap-1.5">{RECENCY_LABEL[recency]} <RecencyBadge recency={recency} /></span>} />
        <Row label="Shares traded that day" value={formatInt(detail.volume)} sub="volume above zero — an actual trade" />
        <Row label="Reference value" value={formatGhs(valuation.referenceValueGhs)} strong />
      </dl>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Reference value = shares × last traded price = {formatInt(detail.shares)} × {formatPrice(detail.priceGhs)}
      </p>
      {detail.skippedNoTradeRows > 0 && (
        <p className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
          GSE has since reported {detail.skippedNoTradeRows} later {detail.skippedNoTradeRows === 1 ? "row" : "rows"} (latest {formatIsoDate(detail.latestReportDate)}) with no trading. Those only repeat the previous close, so they are not used and the price keeps its real trade date.
        </p>
      )}
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">{RECENCY_RULE.EQUITY}</p>
    </div>
  );
}
