"use client";

// ---------------------------------------------------------------------------
// Purchase price → annualized hold-to-maturity return, for every selected
// bond at once (M7.3.2 §7). The chart is for comprehension; the scenario
// table beside it is for precision. EVERY number here comes from the shared
// pricing engine (computePriceSensitivity / computePriceScenario /
// findPriceForReturn) — there is no second return calculation in this file.
//
// All lines are HYPOTHETICAL: they answer "if we could buy at X, what would
// we earn?" and are styled violet/dashed-adjacent accordingly. The only
// observed items are the green "last traded price" markers, which sit on the
// same line at the price the market last printed (not at the observed YTM —
// that was solved at the trade date, this is the return from buying at that
// price today).
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  computePriceScenario,
  computePriceSensitivity,
  findPriceForReturn,
  formatIsoDate,
  formatPct,
  MATURING_SOON_DAYS,
  securityShortLabel,
  sensitivityChartPrices,
  type ComparableRow,
  type TransactionCharges,
} from "@/lib/fixed-income";
import type { WorkspaceSecurity } from "@/lib/queries/fixed-income";
import { HypotheticalBadge } from "./ui";

const SERIES_COLORS = ["#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#3b82f6", "#84cc16", "#eab308", "#64748b"];

function refLabel(r: ComparableRow): string {
  const name = r.instrumentType === "TREASURY_BILL" ? r.instrumentName : securityShortLabel(r.issuerName, r.couponRatePct ?? null, r.maturityDate);
  return `${name} · ${formatPct(r.ytmPct!)} · ${r.observationKind === "AUCTION_PRIMARY" ? "auction" : "trade"} ${r.observationDate ? formatIsoDate(r.observationDate) : ""}${r.freshness === "STALE" ? " (stale)" : ""}`;
}

export function ReturnVsPriceChart({
  bonds,
  valuationDate,
  charges,
  comparables,
  testPrice,
  onTestPriceChange,
  referenceCode,
  onReferenceChange,
  onAddScenario,
}: {
  bonds: WorkspaceSecurity[];
  valuationDate: Date;
  charges: TransactionCharges;
  comparables: ComparableRow[];
  testPrice: string;
  onTestPriceChange: (v: string) => void;
  referenceCode: string;
  onReferenceChange: (code: string) => void;
  onAddScenario: (price: number) => void;
}) {
  // Bonds redeeming within ~3 months: annualizing over days makes returns explode and would flatten every other line.
  const charted = useMemo(() => bonds.filter((b) => b.analytics.tenorDays > MATURING_SOON_DAYS), [bonds]);
  const omitted = bonds.filter((b) => b.analytics.tenorDays <= MATURING_SOON_DAYS);
  const labelByCode = new Map(bonds.map((b) => [b.instrumentCode, securityShortLabel(b.issuerName, b.couponRatePct, b.maturityDate)]));

  const price = Number(testPrice);
  const hasTest = testPrice.trim() !== "" && Number.isFinite(price) && price > 0;
  const reference = referenceCode ? comparables.find((c) => c.instrumentCode === referenceCode && c.ytmPct !== null) : undefined;

  const { rows, lo, hi } = useMemo(() => {
    const observed = charted.map((b) => (b.analyticsEligible ? b.analytics.cleanPrice : null)).filter((p): p is number => p !== null);
    const grids = [sensitivityChartPrices(null), ...observed.map((p) => sensitivityChartPrices(p))];
    const all = grids.flat();
    const lo = Math.min(...all);
    const hi = Math.max(...all, hasTest ? Math.ceil(price + 2) : 0);
    const prices: number[] = [];
    for (let p = Math.floor(lo); p <= hi + 1e-9; p += 0.5) prices.push(p);
    const byBond = charted.map((b) => {
      const sens = computePriceSensitivity(b.terms, valuationDate, prices, charges);
      return { code: b.instrumentCode, map: new Map(sens.ok ? sens.scenarios.map((s) => [s.cleanPrice, s.returnPct] as const) : []) };
    });
    const rows = prices.map((p) => {
      const row: Record<string, number | null> = { price: p };
      for (const b of byBond) row[b.code] = b.map.get(p) ?? null;
      return row;
    });
    return { rows, lo: Math.floor(lo), hi };
  }, [charted, valuationDate, charges, hasTest, price]);

  // Per-bond readouts at the tested price, from the same engine.
  const readouts = charted.map((b, i) => {
    const at = hasTest ? computePriceScenario(b.terms, valuationDate, price, charges) : null;
    const maxPrice = reference ? findPriceForReturn(b.terms, valuationDate, reference.ytmPct!, charges) : null;
    return { b, color: SERIES_COLORS[i % SERIES_COLORS.length], ret: at && at.ok ? at.returnPct : null, maxPrice };
  });

  const referenceOptions = comparables.filter((c) => c.ytmPct !== null && c.tenorDays > 0 && c.analyticsEligible !== false && !bonds.some((b) => b.instrumentCode === c.instrumentCode));

  if (charted.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Select a bond with more than {MATURING_SOON_DAYS} days to maturity to chart purchase price against return.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2 text-xs">
        <label className="flex flex-col gap-0.5 text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-violet-800 dark:text-violet-300">Price to test (hypothetical, clean, per 100)</span>
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              step="0.25"
              min="0"
              value={testPrice}
              onChange={(e) => onTestPriceChange(e.target.value)}
              placeholder="e.g. 102.50"
              aria-label="Hypothetical price to test"
              className="w-28 rounded border border-violet-300 bg-white px-2 py-1 text-sm tabular-nums text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 dark:border-violet-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              type="button"
              disabled={!hasTest}
              onClick={() => hasTest && onAddScenario(price)}
              className="rounded border border-violet-300 px-2 py-1 text-violet-800 hover:bg-violet-50 disabled:opacity-40 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
            >
              Add to table
            </button>
          </span>
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-zinc-600 dark:text-zinc-400">
          <span className="font-medium">Reference yield line (an observed yield elsewhere in the market)</span>
          <select
            value={referenceCode}
            onChange={(e) => onReferenceChange(e.target.value)}
            aria-label="Reference yield"
            className="max-w-xs rounded border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="">None</option>
            {referenceOptions
              .sort((a, b) => Number(a.classification === "CORPORATE") - Number(b.classification === "CORPORATE") || a.tenorDays - b.tenorDays)
              .map((r) => (
                <option key={r.instrumentCode} value={r.instrumentCode}>
                  {r.classification === "SOVEREIGN" ? "Gov · " : "Corp · "}
                  {refLabel(r)}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="rounded border border-dashed border-violet-300 bg-violet-50/30 p-2 dark:border-violet-800 dark:bg-violet-950/10">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-violet-800 dark:text-violet-300">Hypothetical purchase price → annualized return</span>
          <HypotheticalBadge />
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={rows} margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
            <XAxis
              dataKey="price"
              type="number"
              domain={[lo, hi]}
              ticks={Array.from({ length: Math.floor((hi - lo) / 5) + 1 }, (_, i) => Math.ceil(lo / 5) * 5 + i * 5).filter((t) => t <= hi)}
              tick={{ fontSize: 10, fill: "#71717a" }}
              axisLine={{ stroke: "#71717a33" }}
              tickLine={false}
              label={{ value: "Hypothetical clean purchase price (per 100)", position: "insideBottom", offset: -10, fontSize: 10, fill: "#71717a" }}
            />
            <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={48} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} domain={["auto", "auto"]} />
            <ReferenceLine y={0} stroke="#ef444466" strokeDasharray="4 3" />
            <ReferenceLine x={100} stroke="#71717a55" strokeDasharray="2 3" label={{ value: "Par", position: "top", fontSize: 10, fill: "#71717a" }} />
            {reference && <ReferenceLine y={reference.ytmPct!} stroke="#0ea5e9" strokeDasharray="6 3" label={{ value: `Ref ${formatPct(reference.ytmPct!)}`, position: "insideTopRight", fontSize: 10, fill: "#0ea5e9" }} />}
            {hasTest && <ReferenceLine x={price} stroke={SERIES_COLORS[0]} strokeDasharray="3 3" label={{ value: `@ ${price}`, position: "top", fontSize: 10, fill: "#8b5cf6" }} />}
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "#71717a66" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded border border-violet-300 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-violet-700 dark:bg-zinc-900">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Hypothetical · price {Number(label).toFixed(2)}</div>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="tabular-nums" style={{ color: p.color }}>
                        {labelByCode.get(String(p.dataKey)) ?? p.name}
                        : {p.value != null ? formatPct(Number(p.value)) : "—"}
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
            {charted.map((b, i) => (
              <Line key={b.instrumentCode} type="monotone" dataKey={b.instrumentCode} name={b.instrumentCode} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            ))}
            {charted.map((b) => {
              if (!b.analyticsEligible || b.analytics.cleanPrice === null) return null;
              const s = computePriceScenario(b.terms, valuationDate, b.analytics.cleanPrice, charges);
              if (!s.ok || s.returnPct === null) return null;
              return <ReferenceDot key={`obs-${b.instrumentCode}`} x={b.analytics.cleanPrice} y={s.returnPct} r={5} fill="#10b981" stroke="#fff" strokeWidth={2} />;
            })}
          </LineChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
          {readouts.map((r) => (
            <span key={r.b.instrumentCode} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: r.color }} />
              {securityShortLabel(r.b.issuerName, r.b.couponRatePct, r.b.maturityDate)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" /> last traded price (observed)
          </span>
        </div>
      </div>

      {(hasTest || reference) && (
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-violet-50/50 text-[11px] uppercase tracking-wide text-violet-800 dark:border-zinc-800 dark:bg-violet-950/20 dark:text-violet-300">
                <th className="px-3 py-1.5 font-medium">Bond</th>
                {hasTest && <th className="px-3 py-1.5 text-right font-medium">Return if bought @ {price} · hypothetical</th>}
                {reference && <th className="px-3 py-1.5 text-right font-medium">Highest price that still earns {formatPct(reference.ytmPct!)} · hypothetical</th>}
              </tr>
            </thead>
            <tbody>
              {readouts.map((r) => (
                <tr key={r.b.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                  <td className="px-3 py-1.5 text-zinc-800 dark:text-zinc-200">
                    <span aria-hidden className="mr-1.5 inline-block h-0.5 w-3 align-middle" style={{ background: r.color }} />
                    {securityShortLabel(r.b.issuerName, r.b.couponRatePct, r.b.maturityDate)}
                  </td>
                  {hasTest && <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.ret !== null ? formatPct(r.ret) : "—"}</td>}
                  {reference && <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.maxPrice !== null ? r.maxPrice.toFixed(2) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {reference && (
            <p className="px-3 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              Reference: {refLabel(reference)}. “Highest price” is the clean price at which that bond&apos;s hypothetical return equals the reference yield — paying more earns less than the reference. A yield match is not a risk match.
            </p>
          )}
        </div>
      )}

      {omitted.length > 0 && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Not charted: {omitted.map((b) => securityShortLabel(b.issuerName, b.couponRatePct, b.maturityDate)).join(", ")} — within {MATURING_SOON_DAYS} days of maturity, where annualized returns swing too widely to share a scale. Their exact figures are in the table above.
        </p>
      )}
    </div>
  );
}
