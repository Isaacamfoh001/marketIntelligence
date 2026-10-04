"use client";

// ---------------------------------------------------------------------------
// Fixed Income Comparison Tool (M7 §13) — side-by-side table over a
// client-side multi-select. Selection is the only interactive state; all
// figures are pre-computed server-side and passed down as plain data.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Link from "next/link";
import type { ComparableRow } from "@/lib/fixed-income";

function formatTenor(tenorDays: number): string {
  if (tenorDays <= 0) return "Matured";
  if (tenorDays < 365) return `${tenorDays}d`;
  return `${(tenorDays / 365).toFixed(1)}y`;
}

export function CompareTool({ universe }: { universe: ComparableRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  const selectedRows = universe.filter((r) => selected.has(r.instrumentCode));

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Select securities to compare</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {universe.map((r) => (
            <label
              key={r.instrumentCode}
              className="flex items-center gap-2 rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
            >
              <input type="checkbox" checked={selected.has(r.instrumentCode)} onChange={() => toggle(r.instrumentCode)} className="shrink-0" />
              <span className="truncate">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.instrumentCode}</span>{" "}
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{r.issuerName}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {selectedRows.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">Select two or more securities above to compare them side by side.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Security</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Issuer</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Type</th>
                <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Maturity</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Tenor</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">YTM</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Current Yield</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Duration</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">DV01</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Spread</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((r) => (
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
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.maturityDate}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatTenor(r.tenorDays)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{r.ytmPct !== null ? `${r.ytmPct.toFixed(2)}%` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.currentYieldPct !== null ? `${r.currentYieldPct.toFixed(2)}%` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.modifiedDurationYears !== null ? `${r.modifiedDurationYears.toFixed(2)}y` : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.dv01 !== null ? r.dv01.toFixed(4) : "—"}</td>
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
