"use client";

// ---------------------------------------------------------------------------
// "Find Alternatives" (M7 §14, presentation upgraded in M7.3 §18) —
// deterministic comparable-security ranking, filtered client-side over the
// already-computed universe (findComparables/relativeValue are pure).
//
// Shows relative-value DELTAS (yield in bps, tenor in days) against a
// reference yield. The reference is the target's observed YTM when one
// exists; otherwise the caller passes its hypothetical return at price 100,
// and the UI says so. Closest yield is never presented as "better".
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  findComparables,
  relativeValue,
  COMPARABLE_FILTER_LABEL,
  formatBps,
  formatIsoDate,
  formatPct,
  formatTenorDiff,
  formatTimeRemaining,
  securityShortLabel,
  type ComparableFilter,
  type ComparableRow,
} from "@/lib/fixed-income";
import { HypotheticalBadge, Missing, NUM, ObservationCell, TD, TH } from "./ui";

const FILTERS: ComparableFilter[] = ["SIMILAR_RETURN", "SIMILAR_MATURITY", "HIGHER_YIELD", "GOVERNMENT_ONLY", "CORPORATE_ONLY"];

export function FindAlternatives({
  target,
  universe,
  referenceLabel,
  referenceIsHypothetical,
}: {
  target: ComparableRow;
  universe: ComparableRow[];
  /** What the reference yield is, e.g. "Observed YTM" or "Scenario return at price 100". */
  referenceLabel: string;
  referenceIsHypothetical: boolean;
}) {
  const [filter, setFilter] = useState<ComparableFilter>("SIMILAR_RETURN");
  const [recentOnly, setRecentOnly] = useState(false);

  const results = useMemo(() => findComparables(target, universe, filter, { recentOnly }).slice(0, 10), [target, universe, filter, recentOnly]);

  if (target.ytmPct === null) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">Alternatives need a reference yield — this security has neither a market yield nor a computable scenario return.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "border border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {COMPARABLE_FILTER_LABEL[f]}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
            Recent observations only
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          Reference: <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatPct(target.ytmPct)}</span> {referenceLabel} · {formatTimeRemaining(target.tenorDays)}
          {referenceIsHypothetical && <HypotheticalBadge />}
        </div>
      </div>

      {results.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">No outstanding securities with a market yield match this filter.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                <th className={TH}>Alternative</th>
                <th className={`${TH} text-right`}>Observed YTM</th>
                <th className={`${TH} text-right`}>vs reference</th>
                <th className={`${TH} text-right`}>Maturity · tenor diff.</th>
                <th className={`${TH} text-right`}>Spread vs GoG</th>
                <th className={`${TH} text-right`}>Observation</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const rv = relativeValue(target.ytmPct!, target.tenorDays, r);
                const isBill = r.instrumentType === "TREASURY_BILL";
                return (
                  <tr key={r.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className={TD}>
                      <div className="flex items-center gap-1.5">
                        {isBill ? (
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.instrumentName}</span>
                        ) : (
                          <Link href={`/fixed-income/${encodeURIComponent(r.instrumentCode)}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                            {securityShortLabel(r.issuerName, r.couponRatePct ?? null, r.maturityDate)}
                          </Link>
                        )}
                        <span
                          className={`rounded px-1 text-[10px] font-medium ${r.classification === "SOVEREIGN" ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
                        >
                          {r.classification === "SOVEREIGN" ? (isBill ? "Sovereign · T-bill" : "Sovereign") : "Corporate"}
                        </span>
                      </div>
                      {!isBill && <div className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{r.instrumentCode}</div>}
                    </td>
                    <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>{formatPct(r.ytmPct!)}</td>
                    <td className={`${NUM} ${rv.ytmDiffBps !== null && rv.ytmDiffBps < 0 ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                      {rv.ytmDiffBps !== null ? formatBps(rv.ytmDiffBps) : "—"}
                    </td>
                    <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                      {formatIsoDate(r.maturityDate)}
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {formatTimeRemaining(r.tenorDays)} · <span className="text-zinc-600 dark:text-zinc-400">{formatTenorDiff(rv.tenorDiffDays)}</span>
                      </div>
                    </td>
                    <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>
                      {r.classification === "SOVEREIGN" ? <span className="text-xs text-zinc-400 dark:text-zinc-500">n/a</span> : r.spreadBps !== null ? formatBps(r.spreadBps) : <Missing reason="No suitable sovereign benchmark." />}
                    </td>
                    <td className={`${TD} text-right`}>
                      <ObservationCell dateIso={r.observationDate} kind={r.observationKind} freshness={r.freshness} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        Relative-value information only — a similar or higher yield is not a judgement that a security is better. Yields compare observations of different dates, markets
        (primary auction vs secondary trade) and credit risk; check each row&apos;s observation and badge.
      </p>
    </div>
  );
}
