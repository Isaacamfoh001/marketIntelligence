"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface GdpChartPoint {
  date: string; // YYYY-MM-DD, end of the reference quarter
  value: number;
}

function formatQuarterTick(dateStr: string): string {
  const [year, month] = dateStr.split("-").map(Number);
  const quarter = Math.ceil(month / 3);
  return `${year}Q${quarter}`;
}

/**
 * Quarterly GDP growth as bars, not a line: growth is a discrete
 * per-quarter figure (not a continuously observed series like FX/rates),
 * and a zero-crossing bar chart makes contraction quarters immediately
 * legible in a way a line chart doesn't. Bars are colored by sign
 * (negative = contraction) since that's the data's own definition, not
 * an investment judgment.
 */
export function GdpChart({ data, height = 200 }: { data: GdpChartPoint[]; height?: number }) {
  if (data.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Awaiting data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#71717a" }}
          tickFormatter={formatQuarterTick}
          minTickGap={40}
          axisLine={{ stroke: "#71717a33" }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={40} axisLine={false} tickLine={false} />
        <ReferenceLine y={0} stroke="#71717a66" />
        <Tooltip
          formatter={(value) => [`${Number(value).toFixed(1)}%`, "Real GDP growth (YoY)"]}
          labelFormatter={(label) => (typeof label === "string" ? formatQuarterTick(label) : label)}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[2, 2, 0, 0]}>
          {data.map((point) => (
            <Cell key={point.date} fill={point.value >= 0 ? "#3b82f6" : "#ef4444"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
