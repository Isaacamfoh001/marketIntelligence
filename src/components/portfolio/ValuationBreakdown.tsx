// ---------------------------------------------------------------------------
// The calculation behind one position's reference value, laid out so nothing is
// mysterious (M8.1 §17): every input, its date and age, the formula with the
// actual numbers, and the assumption it rests on. Pure presentation of a
// PositionValuation produced by the domain layer — it computes nothing, so the
// same component serves the saved-position drill-down and the live preview in
// the add/edit form.
// ---------------------------------------------------------------------------

import { BOND_ASSUMPTION, RECENCY_LABEL, RECENCY_RULE, type PositionValuation } from "@/lib/portfolio";
import { formatGhs, formatIsoDate, formatPct } from "@/lib/fixed-income";
import { ageText, formatInt, formatPrice, RecencyBadge } from "./ui";

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

export function ValuationBreakdown({ valuation }: { valuation: PositionValuation }) {
  if (valuation.status !== "VALUED") {
    return (
      <div className="text-sm text-zinc-700 dark:text-zinc-300">
        <p className="font-medium">Cannot be valued today</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">{valuation.reason}</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">It is kept in the portfolio and counted as not valued — it is not treated as zero.</p>
      </div>
    );
  }

  const detail = valuation.detail;
  if (detail.assetClass === "BOND") {
    return (
      <div>
        <dl>
          <Row label="Nominal" value={formatGhs(detail.nominalGhs)} />
          <Row label="Observed yield" value={formatPct(detail.observedYtmPct)} sub={detail.yieldFromSourceQuote ? "source-quoted yield (no price published)" : "solved from the traded price at its own date"} />
          <Row label="Observed on" value={formatIsoDate(detail.observationDate)} sub={ageText(detail.ageDays)} />
          <Row label="Input state" value={<span className="inline-flex items-center gap-1.5">{RECENCY_LABEL[valuation.recency]} <RecencyBadge recency={valuation.recency} /></span>} />
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

  return (
    <div>
      <dl>
        <Row label="Shares" value={formatInt(detail.shares)} />
        <Row label="Last traded price" value={`GHS ${formatPrice(detail.priceGhs)}`} sub="GSE closing price (VWAP) on the last day shares actually traded" />
        <Row label="Trade date" value={formatIsoDate(detail.priceDate)} sub={ageText(detail.ageDays)} />
        <Row label="Input state" value={<span className="inline-flex items-center gap-1.5">{RECENCY_LABEL[valuation.recency]} <RecencyBadge recency={valuation.recency} /></span>} />
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
