"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface LadderDatum {
  label: string;
  /** Contractual nominal (GHS) — the bar. */
  nominalGhs: number;
  nominalPct: number | null;
  positionCount: number;
  valuedReferenceValueGhs: number;
  valuedCount: number;
  unvaluedNominalGhs: number;
}

const ghs = (v: number) => `GHS ${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
const axis = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}k` : String(v));

function LadderTooltip({ active, payload }: { active?: boolean; payload?: { payload: LadderDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-zinc-200 bg-white px-2.5 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      <p className="font-semibold">{d.label}</p>
      <p className="tabular-nums">Nominal: {ghs(d.nominalGhs)}{d.nominalPct !== null ? ` (${d.nominalPct.toFixed(1)}%)` : ""}</p>
      <p className="text-zinc-500 dark:text-zinc-400">{d.positionCount} {d.positionCount === 1 ? "bond" : "bonds"}</p>
      <p className="mt-1 text-zinc-500 dark:text-zinc-400 tabular-nums">Valued reference value: {d.valuedCount > 0 ? ghs(d.valuedReferenceValueGhs) : "—"}</p>
      {d.unvaluedNominalGhs > 0 && <p className="text-amber-700 dark:text-amber-400 tabular-nums">Of which not valued: {ghs(d.unvaluedNominalGhs)} nominal</p>}
    </div>
  );
}

/** Contractual nominal by maturity bucket — one bar per bucket (categorical, so bars not a line). */
export function MaturityLadderChart({ data }: { data: LadderDatum[] }) {
  return (
    <div role="img" aria-label={`Contractual bond nominal by maturity: ${data.map((d) => `${d.label} ${ghs(d.nominalGhs)}`).join("; ")}`}>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} axisLine={{ stroke: "#71717a33" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={44} axisLine={false} tickLine={false} tickFormatter={axis} />
          <Tooltip content={<LadderTooltip />} cursor={{ fill: "#71717a1a" }} />
          <Bar dataKey="nominalGhs" fill="#2563eb" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
