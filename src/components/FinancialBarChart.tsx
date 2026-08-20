"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface FinancialBarPoint {
  fiscalYear: number;
  value: number;
}

/** Annual financial trends are categorical (one bar per fiscal year), not a continuous time series — a grouped bar chart, not RatesChart's line-over-dates, is the semantically correct shape here (CLAUDE.md §21: "grouped bars for financial trends"). */
export function FinancialBarChart({
  data,
  unit,
  color = "#3b82f6",
  height = 160,
}: {
  data: FinancialBarPoint[];
  unit: string;
  color?: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <div className="flex h-40 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">Awaiting data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
        <XAxis dataKey="fiscalYear" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={{ stroke: "#71717a33" }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={50} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value) => [`${Number(value).toLocaleString("en-GH", { maximumFractionDigits: 2 })} ${unit}`, ""]} contentStyle={{ fontSize: 12 }} labelFormatter={(year) => `FY${year}`} />
        <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
