"use client";

// ---------------------------------------------------------------------------
// Purchase Price Sensitivity (M7.3 §9–§11/§30). Every row and chart point is
// a HYPOTHETICAL purchase price run through the shared bond engine
// (computePriceSensitivity — accrued interest, remaining cash flows, charges,
// YTM solve). The latest observed market price, when one exists, is added
// as a separately-labelled row/marker so it can never be mistaken for a
// scenario, and vice versa.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  computePriceSensitivity,
  DEFAULT_PURCHASE_CHARGES,
  DEFAULT_SCENARIO_PRICES,
  formatIsoDate,
  formatPct,
  GFIM_BOND_TRANSACTION_LEVY,
  NO_CHARGES,
  SENSITIVITY_TABLE_PRICES,
  sensitivityChartPrices,
  type BondTerms,
} from "@/lib/fixed-income";
import { HypotheticalBadge, NUM, ObservationKindBadge, TH, signedTone } from "./ui";

const LINE_COLOR = "#3b82f6";

/** X-axis ticks on round prices (every 5) so par and the 100/105/110 scenarios sit on gridlines. */
function roundPriceTicks(prices: number[]): number[] {
  if (prices.length === 0) return [];
  const lo = Math.ceil(Math.min(...prices) / 5) * 5;
  const hi = Math.floor(Math.max(...prices) / 5) * 5;
  const ticks: number[] = [];
  for (let p = lo; p <= hi; p += 5) ticks.push(p);
  return ticks;
}

export function PriceSensitivity({
  terms,
  settlementDateIso,
  observedCleanPrice,
  observationDateIso,
  observationKind,
}: {
  terms: BondTerms;
  settlementDateIso: string;
  observedCleanPrice: number | null;
  observationDateIso: string | null;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null;
}) {
  const [includeLevy, setIncludeLevy] = useState(true);
  const [customPrice, setCustomPrice] = useState("");
  const settlementDate = useMemo(() => new Date(`${settlementDateIso}T00:00:00.000Z`), [settlementDateIso]);
  const charges = includeLevy ? DEFAULT_PURCHASE_CHARGES : NO_CHARGES;
  const custom = Number(customPrice);
  const hasCustom = customPrice.trim() !== "" && Number.isFinite(custom) && custom > 0;

  const table = useMemo(() => {
    const prices: number[] = [...SENSITIVITY_TABLE_PRICES];
    if (observedCleanPrice !== null) prices.push(observedCleanPrice);
    if (hasCustom) prices.push(custom);
    return computePriceSensitivity(terms, settlementDate, prices, charges);
  }, [terms, settlementDate, observedCleanPrice, hasCustom, custom, charges]);

  const chart = useMemo(() => computePriceSensitivity(terms, settlementDate, sensitivityChartPrices(observedCleanPrice), charges), [terms, settlementDate, observedCleanPrice, charges]);

  if (!table.ok) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">{table.message}</p>;
  }

  const parReturn = table.scenarios.find((s) => s.cleanPrice === 100)?.returnPct ?? null;
  const observedScenario = observedCleanPrice !== null ? table.scenarios.find((s) => Math.abs(s.cleanPrice - observedCleanPrice) < 1e-6) : undefined;
  const chartTicks = roundPriceTicks(chart.ok ? chart.scenarios.map((s) => s.cleanPrice) : []);
  const chartData = chart.ok ? chart.scenarios.filter((s) => s.returnPct !== null).map((s) => ({ price: s.cleanPrice, returnPct: s.returnPct! })) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            Your price
            <input
              type="number"
              step="0.01"
              min="0"
              value={customPrice}
              onChange={(e) => setCustomPrice(e.target.value)}
              placeholder="e.g. 102.50"
              className="w-24 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex items-center gap-1.5" title={`${GFIM_BOND_TRANSACTION_LEVY.source}: ${GFIM_BOND_TRANSACTION_LEVY.basis}`}>
            <input type="checkbox" checked={includeLevy} onChange={(e) => setIncludeLevy(e.target.checked)} />
            Include {GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC transaction levy
          </label>
        </div>
        <span className="text-zinc-400 dark:text-zinc-500">
          Accrued interest {table.accruedInterest.toFixed(4)} · cash to maturity {table.remainingCashPer100.toFixed(4)} per 100 face · as of {formatIsoDate(settlementDateIso)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="overflow-x-auto rounded border border-zinc-200 xl:col-span-3 dark:border-zinc-800">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                <th className={TH}>Purchase price (clean)</th>
                <th className={`${TH} text-right`}>All-in cost</th>
                <th className={`${TH} text-right`}>Cash P/L to maturity</th>
                <th className={`${TH} text-right`}>Annualized HTM return</th>
                <th className={`${TH} text-right`}>vs price 100</th>
              </tr>
            </thead>
            <tbody>
              {table.scenarios.map((s) => {
                const isObserved = observedScenario === s;
                const isCustom = hasCustom && Math.abs(s.cleanPrice - custom) < 1e-6;
                const isStandard = (DEFAULT_SCENARIO_PRICES as readonly number[]).includes(s.cleanPrice);
                return (
                  <tr
                    key={s.cleanPrice}
                    className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/50 ${isObserved ? "bg-emerald-50/60 dark:bg-emerald-900/10" : isStandard ? "bg-zinc-50/70 dark:bg-zinc-800/20" : ""}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="tabular-nums font-medium text-zinc-900 dark:text-zinc-100">{s.cleanPrice.toFixed(s.cleanPrice % 1 === 0 ? 2 : 4)}</span>{" "}
                      {isObserved ? (
                        <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                          Observed {observationDateIso ? formatIsoDate(observationDateIso) : ""} <ObservationKindBadge kind={observationKind} />
                        </span>
                      ) : isCustom ? (
                        <span className="ml-1 text-[10px] font-medium text-violet-700 dark:text-violet-300">Your price</span>
                      ) : (
                        <span className="ml-1">
                          <HypotheticalBadge />
                        </span>
                      )}
                    </td>
                    <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.allInCost.toFixed(4)}</td>
                    <td className={`${NUM} ${signedTone(s.nominalProfitPer100)}`}>
                      {s.nominalProfitPer100 >= 0 ? "+" : ""}
                      {s.nominalProfitPer100.toFixed(2)}
                    </td>
                    <td className={`${NUM} text-base font-semibold ${s.returnPct !== null ? signedTone(s.returnPct) : ""}`}>{s.returnPct !== null ? formatPct(s.returnPct) : "—"}</td>
                    <td className={`${NUM} text-xs text-zinc-500 dark:text-zinc-400`}>
                      {parReturn !== null && s.returnPct !== null && s.cleanPrice !== 100 ? `${s.returnPct - parReturn >= 0 ? "+" : ""}${Math.round((s.returnPct - parReturn) * 100)} bps` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="xl:col-span-2">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Hypothetical purchase price → annualized HTM return</p>
          {chartData.length < 2 ? (
            <div className="flex h-56 items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">Not enough scenario points to chart</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 12, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" vertical={false} />
                <XAxis
                  dataKey="price"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  ticks={chartTicks}
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  axisLine={{ stroke: "#71717a33" }}
                  tickLine={false}
                  label={{ value: "Clean price (per 100)", position: "insideBottom", offset: -6, fontSize: 10, fill: "#71717a" }}
                />
                <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={48} axisLine={false} tickLine={false} unit="%" domain={["auto", "auto"]} />
                <ReferenceLine y={0} stroke="#ef444466" strokeDasharray="4 3" />
                <ReferenceLine x={100} stroke="#71717a55" strokeDasharray="2 3" label={{ value: "Par", position: "top", fontSize: 10, fill: "#71717a" }} />
                {observedScenario && observedScenario.returnPct !== null && (
                  <ReferenceDot
                    x={observedScenario.cleanPrice}
                    y={observedScenario.returnPct}
                    r={5}
                    fill="#10b981"
                    stroke="#fff"
                    strokeWidth={2}
                    label={{ value: "Observed", position: "top", fontSize: 10, fill: "#10b981" }}
                  />
                )}
                <Tooltip
                  cursor={{ stroke: "#71717a66" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as { price: number; returnPct: number };
                    return (
                      <div className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                        <div className="text-zinc-500 dark:text-zinc-400">Hypothetical price {p.price.toFixed(2)}</div>
                        <div className="font-medium text-zinc-900 dark:text-zinc-100">{formatPct(p.returnPct)} annualized HTM</div>
                      </div>
                    );
                  }}
                />
                <Line type="monotone" dataKey="returnPct" stroke={LINE_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        <span className="font-medium">Scenarios, not quotes.</span> Each row assumes purchase at that clean price on the valuation date, plus accrued interest
        {includeLevy ? ` and the ${GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC bond transaction levy` : ""}, held to maturity with every contractual coupon paid. Annualized
        hold-to-maturity return is gross of tax, compounded at the coupon frequency (simple interest in the final coupon period, per market convention).
      </p>
    </div>
  );
}
