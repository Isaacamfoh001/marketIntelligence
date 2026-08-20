"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface FxChartPoint {
  date: string; // YYYY-MM-DD
  mid: number;
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

export function FxChart({ data, unit }: { data: FxChartPoint[]; unit: string }) {
  const [window, setWindow] = useState<ChartWindow>("YTD");

  const filtered = useMemo(() => {
    if (data.length === 0) return [];
    const latest = new Date(`${data[data.length - 1].date}T00:00:00.000Z`);
    const start = windowStart(window, latest);
    return data.filter((p) => new Date(`${p.date}T00:00:00.000Z`) >= start);
  }, [data, window]);

  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Awaiting FX data
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
        <ResponsiveContainer width="100%" height={180}>
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
              formatter={(value) => [`${Number(value).toFixed(4)} ${unit}`, "Mid rate"]}
              contentStyle={{ fontSize: 12 }}
            />
            <Line type="monotone" dataKey="mid" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
