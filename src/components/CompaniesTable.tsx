"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { describeDirection, DIRECTION_ARROW, SENTIMENT_TEXT_CLASS } from "@/lib/direction";
import { CompanyLogo } from "./CompanyLogo";
import type { CompanyLandingRow } from "@/lib/queries/companies";

function formatGhs(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatLargeGhs(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) >= 1_000_000_000) return `GHS ${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `GHS ${(value / 1_000_000).toFixed(1)}M`;
  return `GHS ${value.toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;
}

function YtdCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
  const { arrow, sentiment } = describeDirection(pct, 0, "higherIsPositive", 1e-9);
  return (
    <span className={SENTIMENT_TEXT_CLASS[sentiment]}>
      {pct === 0 ? DIRECTION_ARROW.flat : arrow} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

export function CompaniesTable({ rows }: { rows: CompanyLandingRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter((r) => r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || (r.sector ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker, company, or sector…"
          className="w-full max-w-xs rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
          {filtered.length} compan{filtered.length === 1 ? "y" : "ies"}
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Ticker</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Company</th>
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Sector</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latest Price</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">YTD</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latest Revenue / Op. Income</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latest PAT</th>
              <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Latest EPS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.ticker} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/40">
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                  <Link href={`/companies/${r.ticker}`} className="flex items-center gap-2 hover:underline">
                    <CompanyLogo ticker={r.ticker} size={22} />
                    {r.ticker}
                  </Link>
                </td>
                <td className="max-w-[200px] truncate px-3 py-2.5 text-zinc-600 dark:text-zinc-400">{r.name}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500 dark:text-zinc-400">{r.sector ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {r.latestPrice !== null ? `GHS ${formatGhs(r.latestPrice)}` : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  <YtdCell pct={r.ytdReturnPct} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatLargeGhs(r.latestRevenue)}
                  {r.primaryRevenueMetric === "OPERATING_INCOME" && r.latestRevenue !== null && (
                    <span className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500">(Op. Income)</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatLargeGhs(r.latestPat)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {r.latestEps !== null ? `GHS ${r.latestEps.toFixed(2)}` : "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                  No companies match this search
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
