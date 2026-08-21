import { SENTIMENT_TEXT_CLASS } from "@/lib/direction";
import type { MarketConditionSummary } from "@/lib/intelligence";

/**
 * Overview's Market Condition card (M8 §21/§23/§27/§41) — a short
 * deterministic headline, its explanation, and each dimension's state.
 * A dimension that didn't count toward the synthesis (stale/missing) still
 * renders here with its own reason, never silently dropped (M8 §39/§40).
 */
export function MarketConditionSection({ summary }: { summary: MarketConditionSummary }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{summary.label}</div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{summary.explanation}</p>
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        Based on {summary.eligibleCount} of {summary.totalCount} market dimensions · methodology {summary.methodologyVersion} · {summary.calculationDate}
      </p>

      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
        {summary.dimensions.map((d) => {
          const unavailable = d.result.freshness !== "CURRENT";
          return (
            <div key={d.key} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{d.label}</span>
                <span className={unavailable ? "text-zinc-400 dark:text-zinc-500" : SENTIMENT_TEXT_CLASS[d.result.sentiment]}>
                  {d.result.headline}
                  {d.result.freshness === "STALE" && <span className="ml-1 text-[10px] uppercase">(stale)</span>}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{d.result.explanation}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
