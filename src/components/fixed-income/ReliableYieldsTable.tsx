"use client";

// ---------------------------------------------------------------------------
// Reliable observed yields (M7.3 §6, hardened in M7.3.1; renamed in M7.3.2
// and the file renamed in M7.4: a high yield says nothing about merit — it
// can reflect credit risk, illiquidity or an old quote) — outstanding
// securities whose latest market observation is a real, analytics-eligible
// trade/quote (never a carried price or a print withheld for data-quality
// review), so they are actually analyzable today. Securities with known terms but no quote are
// deliberately NOT ranked here alongside quoted ones; they remain one click
// away in the Securities Universe below. Sorting is by a single displayed
// column — never a composite score or a recommendation.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { formatIsoDate, formatPct, formatTimeRemaining } from "@/lib/fixed-income";
import type { WorkspaceSecurity } from "@/lib/queries/fixed-income";
import { BenchmarkCell, LifecycleBadge, MarketStatusCell, Missing, NUM, SecurityIdentity, TD, TH, securityToMarketStatus } from "./ui";

type SortKey = "maturity" | "ytm" | "spread" | "price";
type TypeFilter = "ALL" | "CORPORATE" | "SOVEREIGN";

export function ReliableYieldsTable({ securities }: { securities: WorkspaceSecurity[] }) {
  const [type, setType] = useState<TypeFilter>("ALL");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "maturity", dir: 1 });
  const [recentOnly, setRecentOnly] = useState(true);

  const rows = useMemo(() => {
    const filtered = securities.filter((s) => (type === "ALL" || s.classification === type) && (!recentOnly || s.observationFreshness === "CURRENT"));
    const val = (s: WorkspaceSecurity): number | null =>
      sort.key === "maturity" ? s.analytics.tenorDays : sort.key === "ytm" ? s.analytics.ytmPct : sort.key === "spread" ? s.spreadBps : s.analytics.cleanPrice;
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // missing values always sort last, never as zero
      if (vb === null) return -1;
      return (va - vb) * sort.dir;
    });
  }, [securities, type, sort, recentOnly]);

  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th className={`${TH} ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => setSort((p) => ({ key, dir: p.key === key ? ((p.dir * -1) as 1 | -1) : key === "maturity" ? 1 : -1 }))}
        className="uppercase hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: "ALL", label: "All" },
            { value: "CORPORATE", label: "Corporate" },
            { value: "SOVEREIGN", label: "Government" },
          ]}
        />
        <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
          Traded in the last 10 days only
        </label>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{rows.length} securities</span>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-zinc-200 bg-white px-4 py-6 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
          No outstanding securities in this group have a {recentOnly ? "recent, " : ""}reliable market observation{recentOnly ? " — untick the filter to include older trades" : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className={TH}>Security</th>
                {header("ytm", "Observed YTM")}
                {header("spread", "Benchmark")}
                {header("price", "Price")}
                {header("maturity", "Maturity")}
                <th className={`${TH} text-right`}>Last market observation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.instrumentCode} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                  <td className={TD}>
                    <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
                  </td>
                  <td className={`${NUM} text-lg font-semibold text-zinc-900 dark:text-zinc-100`}>
                    {formatPct(s.analytics.ytmPct!)}
                    <div className="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">{s.analytics.ytmSource === "SOURCE_QUOTED" ? "source-quoted" : "solved from price"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <BenchmarkCell ctx={s.benchmarkContext} />
                  </td>
                  <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                    {s.analytics.cleanPrice !== null ? s.analytics.cleanPrice.toFixed(2) : <Missing short="Not reported" reason="The observation reports a yield but no price." />}
                  </td>
                  <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                    {formatIsoDate(s.maturityDate)}
                    <div className="flex items-center justify-end gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                      <LifecycleBadge lifecycle={s.lifecycle} />
                      {formatTimeRemaining(s.analytics.tenorDays)}
                    </div>
                  </td>
                  <td className={`${TD} text-right`}>
                    <MarketStatusCell s={securityToMarketStatus(s)} />
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

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="inline-flex rounded border border-zinc-200 p-0.5 dark:border-zinc-700">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
            value === o.value ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`ml-1 ${value === o.value ? "opacity-70" : "text-zinc-400 dark:text-zinc-500"}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
