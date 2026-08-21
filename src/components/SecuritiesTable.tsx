"use client";

import { useMemo, useState } from "react";
import { describeDirection, DIRECTION_ARROW, SENTIMENT_TEXT_CLASS } from "@/lib/direction";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { SecuritySnapshot } from "@/lib/queries/equities";

const PAGE_SIZE = 25;

type SortKey = "ticker" | "price" | "1D" | "1M" | "YTD" | "volume" | "value" | "lastTradingDate";
type SortDir = "asc" | "desc";

function formatGhs(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-GH");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Equity return convention: rising is positive (green), falling is negative (red) — the opposite polarity of inflation/USD-GHS, same shared direction system. */
function ReturnCell({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
  const { arrow, sentiment } = describeDirection(pct, 0, "higherIsPositive", 1e-9);
  return (
    <span className={SENTIMENT_TEXT_CLASS[sentiment]}>
      {pct === 0 ? DIRECTION_ARROW.flat : arrow} {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

const SECURITY_TYPE_LABELS: Record<string, string> = {
  ORDINARY_SHARE: "Ordinary",
  PREFERENCE_SHARE: "Preference",
  DEPOSITARY_SHARE: "Depositary",
  ETF: "ETF",
};

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 ${active ? "text-zinc-900 dark:text-zinc-100" : ""}`}
      >
        {label}
        {active && <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

export function SecuritiesTable({ securities }: { securities: SecuritySnapshot[] }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("ticker");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);

  const availableTypes = useMemo(() => Array.from(new Set(securities.map((s) => s.securityType))).sort(), [securities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return securities.filter((s) => {
      if (typeFilter !== "ALL" && s.securityType !== typeFilter) return false;
      if (q === "") return true;
      return s.ticker.toLowerCase().includes(q) || s.companyName.toLowerCase().includes(q);
    });
  }, [securities, search, typeFilter]);

  const sorted = useMemo(() => {
    const withKey = (s: SecuritySnapshot): number | string => {
      switch (sortKey) {
        case "ticker": return s.ticker;
        case "price": return s.latestPrice ?? -Infinity;
        case "1D": return s.returns["1D"]?.pct ?? -Infinity;
        case "1M": return s.returns["1M"]?.pct ?? -Infinity;
        case "YTD": return s.returns.YTD?.pct ?? -Infinity;
        case "volume": return s.latestVolume ?? -Infinity;
        case "value": return s.latestValueTradedGhs ?? -Infinity;
        case "lastTradingDate": return s.latestDate ?? "";
      }
    };
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = withKey(a);
      const bv = withKey(b);
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ticker" ? "asc" : "desc");
    }
    setPage(0);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search ticker or company…"
          className="w-full max-w-xs rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        {availableTypes.length > 1 && (
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(0);
            }}
            className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          >
            <option value="ALL">All types</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {SECURITY_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
          {sorted.length} securit{sorted.length === 1 ? "y" : "ies"}
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full min-w-[880px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <SortHeader label="Ticker" sortKey="ticker" active={sortKey === "ticker"} dir={sortDir} onSort={handleSort} align="left" />
              <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Company</th>
              <SortHeader label="Price" sortKey="price" active={sortKey === "price"} dir={sortDir} onSort={handleSort} />
              <SortHeader label="1D" sortKey="1D" active={sortKey === "1D"} dir={sortDir} onSort={handleSort} />
              <SortHeader label="1M" sortKey="1M" active={sortKey === "1M"} dir={sortDir} onSort={handleSort} />
              <SortHeader label="YTD" sortKey="YTD" active={sortKey === "YTD"} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Volume" sortKey="volume" active={sortKey === "volume"} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Value Traded" sortKey="value" active={sortKey === "value"} dir={sortDir} onSort={handleSort} />
              <SortHeader label="Last Trading Date" sortKey="lastTradingDate" active={sortKey === "lastTradingDate"} dir={sortDir} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((s) => (
              <tr key={s.securityId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                  <div className="flex items-center gap-2">
                    <CompanyLogo ticker={s.ticker} size={18} />
                    {s.ticker}
                  </div>
                </td>
                <td className="max-w-[220px] truncate px-3 py-2.5 text-zinc-600 dark:text-zinc-400">{s.companyName}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {s.latestPrice !== null ? `GHS ${formatGhs(s.latestPrice)}` : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums"><ReturnCell pct={s.returns["1D"]?.pct ?? null} /></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums"><ReturnCell pct={s.returns["1M"]?.pct ?? null} /></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums"><ReturnCell pct={s.returns.YTD?.pct ?? null} /></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{formatCount(s.latestVolume)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
                  {s.latestValueTradedGhs !== null ? `GHS ${formatCount(s.latestValueTradedGhs)}` : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-zinc-500 dark:text-zinc-400">{formatDate(s.latestDate)}</td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
                  No securities match this search/filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            Page {clampedPage + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={clampedPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-zinc-200 px-2 py-1 disabled:opacity-40 dark:border-zinc-800"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={clampedPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded border border-zinc-200 px-2 py-1 disabled:opacity-40 dark:border-zinc-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
