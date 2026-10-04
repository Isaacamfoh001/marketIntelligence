"use client";

// ---------------------------------------------------------------------------
// "Find Alternatives" (M7 §14) — deterministic comparable-security ranking.
// Filtering happens entirely client-side over the already-computed universe
// passed down from the server (findComparables is a pure function with no
// I/O), so switching filters is instant and never re-queries the database.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import { findComparables, COMPARABLE_FILTER_LABEL, type ComparableFilter, type ComparableRow } from "@/lib/fixed-income";

const FILTERS: ComparableFilter[] = ["SIMILAR_RETURN", "SIMILAR_MATURITY", "HIGHER_YIELD", "GOVERNMENT_ONLY", "CORPORATE_ONLY"];

function formatTenor(tenorDays: number): string {
  if (tenorDays < 365) return `${tenorDays}d`;
  return `${(tenorDays / 365).toFixed(1)}y`;
}

export function FindAlternatives({ target, universe }: { target: ComparableRow; universe: ComparableRow[] }) {
  const [filter, setFilter] = useState<ComparableFilter>("SIMILAR_RETURN");

  const results = useMemo(() => findComparables(target, universe, filter).slice(0, 10), [target, universe, filter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
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
      </div>

      {results.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">No comparable securities match this filter yet.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Security</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Issuer</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Type</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tenor</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">YTM</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Duration</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Spread</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">
                    {r.instrumentType === "TREASURY_BILL" ? (
                      r.instrumentName
                    ) : (
                      <Link href={`/fixed-income/${encodeURIComponent(r.instrumentCode)}`} className="hover:underline">
                        {r.instrumentCode}
                      </Link>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.issuerName}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.classification === "SOVEREIGN" ? "Sovereign" : "Corporate"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatTenor(r.tenorDays)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{r.ytmPct?.toFixed(2)}%</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {r.modifiedDurationYears !== null ? `${r.modifiedDurationYears.toFixed(2)}y` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                    {r.spreadBps !== null ? `${r.spreadBps >= 0 ? "+" : ""}${r.spreadBps} bps` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
