"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface RatesSeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface RatesSeries {
  key: string;
  label: string;
  color: string;
  data: RatesSeriesPoint[];
}

const WINDOWS = ["1M", "3M", "YTD", "MAX"] as const;
type ChartWindow = (typeof WINDOWS)[number];

function windowStart(window: ChartWindow, latest: Date): Date {
  const d = new Date(latest);
  if (window === "1M") {
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d;
  }
  if (window === "3M") {
    d.setUTCMonth(d.getUTCMonth() - 3);
    return d;
  }
  if (window === "YTD") {
    return new Date(Date.UTC(latest.getUTCFullYear(), 0, 1));
  }
  return new Date(0);
}

function formatTick(dateStr: string): string {
  return dateStr.slice(5); // MM-DD
}

/**
 * Merges N series (each with its own observation dates — auctions/rate
 * decisions don't all land on the same calendar day) into one row per
 * distinct date, leaving a series' field absent on dates it has no
 * observation for. Recharts then draws a gap rather than interpolating
 * or forward-filling a value that was never published.
 */
function mergeSeries(series: RatesSeries[]): Record<string, string | number>[] {
  const byDate = new Map<string, Record<string, string | number>>();
  for (const s of series) {
    for (const point of s.data) {
      const row = byDate.get(point.date) ?? { date: point.date };
      row[s.key] = point.value;
      byDate.set(point.date, row);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date as string).localeCompare(b.date as string));
}

export function RatesChart({
  series,
  unit,
  height = 180,
}: {
  series: RatesSeries[];
  unit: string;
  height?: number;
}) {
  const [window, setWindow] = useState<ChartWindow>("YTD");

  const merged = useMemo(() => mergeSeries(series), [series]);

  const filtered = useMemo(() => {
    if (merged.length === 0) return [];
    const latest = new Date(`${merged[merged.length - 1].date}T00:00:00.000Z`);
    const start = windowStart(window, latest);
    return merged.filter((row) => new Date(`${row.date}T00:00:00.000Z`) >= start);
  }, [merged, window]);

  const hasAnyData = series.some((s) => s.data.length > 0);

  if (!hasAnyData) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Awaiting data
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex justify-end gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindow(w)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              window === w
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {w}
          </button>
        ))}
      </div>
      {filtered.length < 2 ? (
        <div className="flex h-44 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
          Not enough history in this window yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={filtered} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#71717a" }}
              tickFormatter={formatTick}
              minTickGap={40}
              axisLine={{ stroke: "#71717a33" }}
              tickLine={false}
            />
            <YAxis
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "#71717a" }}
              width={44}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(4)} ${unit}`, name]}
              contentStyle={{ fontSize: 12 }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
