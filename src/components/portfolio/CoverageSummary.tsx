// ---------------------------------------------------------------------------
// Headline reference value + coverage (M8.1 §9). Percentages are over the
// VALUED portion only and the component says so whenever the portfolio is
// incomplete; there is no confidence score or rating anywhere.
// ---------------------------------------------------------------------------

import type { PortfolioValuationSummary } from "@/lib/portfolio";
import { formatGhs, formatIsoDate } from "@/lib/fixed-income";
import { formatPctOf } from "./ui";

export function CoverageSummary({ summary }: { summary: PortfolioValuationSummary }) {
  const { referenceValueGhs: value, positionCount, valuedCount, unvaluedCount } = summary;
  const range = summary.inputDateRange;
  const ages = summary.inputAgeRangeDays;
  const recentW = summary.recentPct ?? 0;
  const staleW = summary.stalePct ?? 0;

  return (
    <section aria-label="Portfolio reference value" className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Reference value</p>
          <p className="mt-0.5 text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value === null ? "—" : formatGhs(value)}</p>
          {value === null && positionCount > 0 && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">None of this portfolio&rsquo;s positions can be valued today — see the reasons below.</p>}
          {value === null && positionCount === 0 && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Add positions to see what they can responsibly be said to be worth.</p>}
          {value !== null && unvaluedCount > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Covers the {valuedCount} valued {valuedCount === 1 ? "position" : "positions"} only — the {unvaluedCount} not valued {unvaluedCount === 1 ? "is" : "are"} excluded, not counted as zero.</p>}
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold tabular-nums">{valuedCount}</span> of <span className="font-semibold tabular-nums">{positionCount}</span> positions valued
          </p>
          <dl className="mt-2 space-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="flex gap-1.5">
              <dt>Valued:</dt>
              <dd className="text-zinc-700 dark:text-zinc-300">{formatIsoDate(summary.valuationDate)}</dd>
            </div>
            {range && ages && (
              <>
                <div className="flex gap-1.5">
                  <dt>Inputs dated:</dt>
                  <dd className="text-zinc-700 dark:text-zinc-300">{range.from === range.to ? formatIsoDate(range.from) : `${formatIsoDate(range.from)} to ${formatIsoDate(range.to)}`}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt>Ages:</dt>
                  <dd className="text-zinc-700 dark:text-zinc-300">{ages.min === ages.max ? `${ages.min} days` : `${ages.min} to ${ages.max} days`}</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Input freshness{unvaluedCount > 0 ? " — of the valued portion" : ""}</p>
          {value === null ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No valued positions, so there is no coverage to show.</p>
          ) : (
            <>
              <div
                className="mt-2 flex h-3 w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800"
                role="img"
                aria-label={`${formatPctOf(summary.recentPct)} of valued reference value rests on recent inputs and ${formatPctOf(summary.stalePct)} on stale inputs`}
              >
                <div className="bg-emerald-500" style={{ width: `${recentW}%` }} />
                <div className="bg-amber-500" style={{ width: `${staleW}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <span className="inline-block size-2 rounded-sm bg-emerald-500" aria-hidden /> Recent inputs
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatPctOf(summary.recentPct)}</dd>
                  <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{summary.recentCount} {summary.recentCount === 1 ? "position" : "positions"} · {formatGhs(summary.recentValueGhs)}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    <span className="inline-block size-2 rounded-sm bg-amber-500" aria-hidden /> Stale inputs
                  </dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatPctOf(summary.stalePct)}</dd>
                  <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{summary.staleCount} {summary.staleCount === 1 ? "position" : "positions"} · {formatGhs(summary.staleValueGhs)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Not valued</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{unvaluedCount}</dd>
                  <dd className="text-[11px] text-zinc-500 dark:text-zinc-400">{unvaluedCount === 0 ? "none" : unvaluedCount === 1 ? "position, listed below" : "positions, listed below"}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                {unvaluedCount > 0 ? `Percentages are of the valued reference value (${formatGhs(value)}) only — not of the whole portfolio.` : "Percentages are of the portfolio reference value."}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
