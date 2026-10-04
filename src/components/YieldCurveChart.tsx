"use client";

// ---------------------------------------------------------------------------
// Ghana sovereign yield curve (M7 §11) — tenor on the x-axis, yield on the
// y-axis. The connecting line between points is a rendering convenience
// for readability, never a computed interpolated value: no numeric
// interpolation happens anywhere in this component or the data it is given
// (M7 §11: "do not fabricate interpolation precision unsupported by the
// data"). Each dot's tooltip always identifies it as an observed point.
// ---------------------------------------------------------------------------

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface YieldCurveChartPoint {
  tenorDays: number;
  tenorLabel: string;
  yieldPct: number;
  instrumentLabel: string;
  isGovernmentBond: boolean;
}

export function YieldCurveChart({ points, height = 240 }: { points: YieldCurveChartPoint[]; height?: number }) {
  if (points.length === 0) {
    return <div className="flex h-44 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">Awaiting data</div>;
  }
  if (points.length < 2) {
    return <div className="flex h-44 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">Not enough observed points to draw a curve yet</div>;
  }

  const sorted = [...points].sort((a, b) => a.tenorDays - b.tenorDays);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={sorted} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
          <XAxis dataKey="tenorLabel" tick={{ fontSize: 10, fill: "#71717a" }} axisLine={{ stroke: "#71717a33" }} tickLine={false} />
          <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "#71717a" }} width={44} axisLine={false} tickLine={false} unit="%" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as YieldCurveChartPoint;
              return (
                <div className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{p.instrumentLabel}</div>
                  <div className="text-zinc-500 dark:text-zinc-400">
                    {p.tenorLabel} tenor · {p.yieldPct.toFixed(2)}% (observed)
                  </div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="yieldPct" name="Yield" stroke="#3b82f6" strokeWidth={1.5} dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        Observed points only — the connecting line is a visual aid, not a computed or interpolated rate.
      </p>
    </div>
  );
}
