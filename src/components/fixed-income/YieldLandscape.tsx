"use client";

// ---------------------------------------------------------------------------
// Ghana Yield Landscape (M7.3.2 §4/§5) — where Treasury bills, government
// bonds and corporate bonds sit on maturity × observed yield.
//
// A SCATTER, deliberately not a curve: Ghana's secondary market is thin and
// asynchronous — each point is a different security observed on its own
// date — so joining them with a line would imply a synchronised, continuous
// market that does not exist. Nothing is interpolated.
//
//   • filled marker  = recent observation        • hollow marker = stale
//   • square T-bill · circle government · triangle corporate (shape + colour)
//   • REVIEW / EXCLUDED observations are NOT plotted — they are listed
//     under the chart with their reasons (never a normal-looking point)
//   • violet diamond (Compare only) = HYPOTHETICAL return at a user price —
//     never an observation, labelled as such in marker, tooltip and legend
//
// Clicking a point opens its intelligence card with a drill-down to the
// security. Axis: square-root scaled maturity so the short end (where most
// Ghana instruments sit) stays legible without hiding long-dated points.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import {
  comparability,
  COMPARABILITY_LABEL,
  findComparables,
  formatIsoDate,
  formatPct,
  formatTimeRemaining,
  LANDSCAPE_GROUP_LABEL,
  securityShortLabel,
  type ComparableRow,
  type LandscapeGroup,
  type LandscapePoint,
  type WithheldObservation,
} from "@/lib/fixed-income";
import { BenchmarkCell, FreshnessBadge, ObservationKindBadge } from "./ui";

export const GROUP_COLOR: Record<LandscapeGroup, string> = {
  TBILL: "#0ea5e9",
  GOVERNMENT: "#6366f1",
  CORPORATE: "#f59e0b",
};
const HYPO_COLOR = "#8b5cf6";
const DAYS_PER_YEAR = 365.25;

export interface HypotheticalMarker {
  id: string;
  label: string;
  tenorDays: number;
  /** Annualized hold-to-maturity return at `price`, from the shared pricing engine. */
  returnPct: number;
  price: number;
}

interface Datum {
  x: number;
  y: number;
  point?: LandscapePoint;
  hypo?: HypotheticalMarker;
}

function formatTenorAxis(years: number): string {
  if (years < 1) return `${Math.round(years * 12)}M`;
  return `${Number.isInteger(years) ? years : years.toFixed(1)}Y`;
}

function Marker({ cx, cy, group, hollow, ring, selected, label, onSelect }: { cx: number; cy: number; group: LandscapeGroup | "HYPO"; hollow: boolean; ring: boolean; selected: boolean; label: string; onSelect?: () => void }) {
  const color = group === "HYPO" ? HYPO_COLOR : GROUP_COLOR[group];
  const fill = hollow ? "transparent" : color;
  const common = { fill, stroke: color, strokeWidth: hollow ? 1.75 : 1, fillOpacity: hollow ? 0 : 0.9, strokeDasharray: group === "HYPO" ? "2 1.5" : undefined };
  const r = 5.5;
  let shape: React.ReactNode;
  if (group === "TBILL") shape = <rect x={cx - r + 0.5} y={cy - r + 0.5} width={2 * r - 1} height={2 * r - 1} {...common} />;
  else if (group === "CORPORATE") shape = <polygon points={`${cx},${cy - r - 0.5} ${cx + r + 0.5},${cy + r - 1} ${cx - r - 0.5},${cy + r - 1}`} {...common} />;
  else if (group === "HYPO") shape = <polygon points={`${cx},${cy - r - 1.5} ${cx + r + 1.5},${cy} ${cx},${cy + r + 1.5} ${cx - r - 1.5},${cy}`} {...common} />;
  else shape = <circle cx={cx} cy={cy} r={r} {...common} />;
  return (
    <g
      role={onSelect ? "button" : "img"}
      aria-label={label}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={onSelect ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect()) : undefined}
      style={{ cursor: onSelect ? "pointer" : "default", outline: "none" }}
    >
      {(selected || ring) && <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={selected ? "#ef4444" : "#71717a"} strokeWidth={selected ? 2 : 1.25} strokeDasharray={selected ? undefined : "3 2"} />}
      {shape}
    </g>
  );
}

function PointTooltip({ d }: { d: Datum }) {
  if (d.hypo) {
    return (
      <div className="max-w-[16rem] rounded border border-violet-300 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-violet-700 dark:bg-zinc-900">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">Hypothetical — not a market observation</div>
        <div className="mt-0.5 font-medium text-zinc-900 dark:text-zinc-100">{d.hypo.label}</div>
        <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
          {formatPct(d.hypo.returnPct)} <span className="text-zinc-500 dark:text-zinc-400">annualized return if bought at {d.hypo.price}</span>
        </div>
        <div className="text-zinc-500 dark:text-zinc-400">{formatTimeRemaining(d.hypo.tenorDays)} remaining</div>
      </div>
    );
  }
  const p = d.point!;
  return (
    <div className="max-w-[17rem] rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="font-medium text-zinc-900 dark:text-zinc-100">{p.label}</div>
      <div className="text-zinc-500 dark:text-zinc-400">
        {p.issuerName}
        {p.couponRatePct !== null ? ` · ${p.couponRatePct.toFixed(2)}% coupon` : ""} · matures {formatIsoDate(p.maturityDate)}
      </div>
      <div className="mt-1 tabular-nums text-zinc-900 dark:text-zinc-100">
        <span className="text-sm font-semibold">{formatPct(p.yieldPct)}</span> <span className="text-zinc-500 dark:text-zinc-400">{p.ytmSource === "SOURCE_QUOTED" ? "source-quoted" : p.observationKind === "AUCTION_PRIMARY" ? "auction rate" : "solved from price"}</span>
        {p.cleanPrice !== null && <span className="text-zinc-500 dark:text-zinc-400"> · price {p.cleanPrice.toFixed(2)}</span>}
      </div>
      <div className="text-zinc-500 dark:text-zinc-400">
        {p.observationKind === "AUCTION_PRIMARY" ? "Primary auction" : "Secondary trade"} {formatIsoDate(p.observationDate)}
        {p.ageDays !== null ? ` · ${p.ageDays}d ago` : ""} · {p.freshness === "CURRENT" ? "recent" : <span className="font-medium text-amber-600 dark:text-amber-400">stale</span>}
      </div>
      {p.termsConflict && <div className="text-orange-600 dark:text-orange-400">⚠ Terms conflict: {p.termsConflict}</div>}
      <div className="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">Click for details</div>
    </div>
  );
}

export function YieldLandscape({
  points,
  withheld,
  notPlotted,
  comparables,
  highlightIds,
  hypotheticals = [],
  height = 340,
  compareCta = true,
}: {
  points: LandscapePoint[];
  withheld: WithheldObservation[];
  notPlotted: { carriedOnly: number; neverQuoted: number };
  /** Full comparable universe — for the card's "potential comparables". */
  comparables: ComparableRow[];
  /** Securities to ring (e.g. the Compare selection). */
  highlightIds?: ReadonlySet<string>;
  /** Hypothetical returns to overlay (Compare). */
  hypotheticals?: HypotheticalMarker[];
  height?: number;
  compareCta?: boolean;
}) {
  const [visible, setVisible] = useState<Set<LandscapeGroup>>(new Set(["TBILL", "GOVERNMENT", "CORPORATE"]));
  const [recentOnly, setRecentOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const shown = useMemo(() => points.filter((p) => visible.has(p.group) && (!recentOnly || p.freshness === "CURRENT")), [points, visible, recentOnly]);
  const staleHidden = recentOnly ? points.filter((p) => visible.has(p.group) && p.freshness === "STALE").length : 0;
  const selected = selectedId ? (points.find((p) => p.id === selectedId) ?? null) : null;

  const series = useMemo(
    () =>
      (["TBILL", "GOVERNMENT", "CORPORATE"] as LandscapeGroup[]).map((g) => ({
        group: g,
        data: shown.filter((p) => p.group === g).map<Datum>((p) => ({ x: p.tenorDays / DAYS_PER_YEAR, y: p.yieldPct, point: p })),
      })),
    [shown],
  );
  const hypoData = useMemo(() => hypotheticals.map<Datum>((h) => ({ x: h.tenorDays / DAYS_PER_YEAR, y: h.returnPct, hypo: h })), [hypotheticals]);

  const allY = [...shown.map((p) => p.yieldPct), ...hypotheticals.map((h) => h.returnPct)];
  const maxX = Math.max(1, ...shown.map((p) => p.tenorDays / DAYS_PER_YEAR), ...hypotheticals.map((h) => h.tenorDays / DAYS_PER_YEAR));
  const yMax = Math.max(10, Math.ceil((Math.max(0, ...allY) + 2) / 5) * 5);
  const minY = Math.min(0, ...allY);
  const yMin = minY < 0 ? Math.floor(minY / 5) * 5 : 0;
  const yStep = yMax - yMin > 40 ? 10 : 5;
  const yTicks: number[] = [];
  for (let t = yMin; t <= yMax; t += yStep) yTicks.push(t);
  const xTicks = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20].filter((t) => t <= maxX + 0.3);

  function toggleGroup(g: LandscapeGroup) {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  const counts: Record<LandscapeGroup, number> = { TBILL: 0, GOVERNMENT: 0, CORPORATE: 0 };
  for (const p of points) counts[p.group]++;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {(["GOVERNMENT", "CORPORATE", "TBILL"] as LandscapeGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={visible.has(g)}
              onClick={() => toggleGroup(g)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                visible.has(g) ? "border-zinc-300 text-zinc-900 dark:border-zinc-600 dark:text-zinc-100" : "border-zinc-200 text-zinc-400 line-through dark:border-zinc-800 dark:text-zinc-600"
              }`}
            >
              <span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: GROUP_COLOR[g], borderRadius: g === "GOVERNMENT" ? "9999px" : g === "TBILL" ? "1px" : "0", clipPath: g === "CORPORATE" ? "polygon(50% 0, 100% 100%, 0 100%)" : undefined }} />
              {LANDSCAPE_GROUP_LABEL[g]} <span className="tabular-nums text-zinc-400 dark:text-zinc-500">{counts[g]}</span>
            </button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
            Recent only
            {recentOnly && staleHidden > 0 && <span className="text-zinc-400 dark:text-zinc-500">({staleHidden} stale hidden)</span>}
          </label>
        </div>

        {shown.length === 0 && hypoData.length === 0 ? (
          <div className="flex items-center justify-center rounded border border-dashed border-zinc-200 text-sm text-zinc-400 dark:border-zinc-800 dark:text-zinc-500" style={{ height }}>
            {points.length === 0 ? "No reliable observations to plot yet." : "No observations match these filters."}
          </div>
        ) : (
          <div role="group" aria-label="Ghana yield landscape: maturity versus observed yield. Each point is a security; select one for details.">
            <ResponsiveContainer width="100%" height={height}>
              <ScatterChart margin={{ top: 10, right: 16, bottom: 22, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#71717a33" />
                <XAxis
                  type="number"
                  dataKey="x"
                  scale="sqrt"
                  domain={[0, Math.ceil(maxX + 0.3)]}
                  ticks={xTicks}
                  tickFormatter={formatTenorAxis}
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  axisLine={{ stroke: "#71717a33" }}
                  tickLine={false}
                  allowDataOverflow
                  label={{ value: "Time to maturity (compressed scale)", position: "insideBottom", offset: -12, fontSize: 10, fill: "#71717a" }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  domain={[yMin, yMax]}
                  ticks={yTicks}
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  width={44}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3", stroke: "#71717a66" }}
                  isAnimationActive={false}
                  content={({ active, payload }) => (active && payload?.length ? <PointTooltip d={payload[0].payload as Datum} /> : null)}
                />
                {series.map((s) => (
                  <Scatter
                    key={s.group}
                    name={LANDSCAPE_GROUP_LABEL[s.group]}
                    data={s.data}
                    isAnimationActive={false}
                    shape={(props: unknown) => {
                      const { cx, cy, payload } = props as { cx: number; cy: number; payload: Datum };
                      const p = payload.point!;
                      return (
                        <Marker
                          cx={cx}
                          cy={cy}
                          group={p.group}
                          hollow={p.freshness === "STALE"}
                          ring={highlightIds?.has(p.id) ?? false}
                          selected={p.id === selectedId}
                          label={`${p.label}, ${formatPct(p.yieldPct)}, ${p.freshness === "CURRENT" ? "recent" : "stale"} observation ${formatIsoDate(p.observationDate)}`}
                          onSelect={() => setSelectedId((cur) => (cur === p.id ? null : p.id))}
                        />
                      );
                    }}
                  />
                ))}
                {hypoData.length > 0 && (
                  <Scatter
                    name="Hypothetical"
                    data={hypoData}
                    isAnimationActive={false}
                    shape={(props: unknown) => {
                      const { cx, cy, payload } = props as { cx: number; cy: number; payload: Datum };
                      return <Marker cx={cx} cy={cy} group="HYPO" hollow ring={false} selected={false} label={`Hypothetical return ${formatPct(payload.hypo!.returnPct)} for ${payload.hypo!.label} at price ${payload.hypo!.price}`} />;
                    }}
                  />
                )}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="#71717a" /></svg> filled = recent
          </span>
          <span className="inline-flex items-center gap-1">
            <svg width="12" height="12" aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="#71717a" strokeWidth="1.75" /></svg> hollow = stale
          </span>
          {hypotheticals.length > 0 && (
            <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
              <svg width="12" height="12" aria-hidden><polygon points="6,0.5 11.5,6 6,11.5 0.5,6" fill="none" stroke={HYPO_COLOR} strokeWidth="1.5" strokeDasharray="2 1.5" /></svg> hypothetical return — not an observation
            </span>
          )}
          {highlightIds && highlightIds.size > 0 && (
            <span className="inline-flex items-center gap-1">
              <svg width="14" height="14" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="#71717a" strokeDasharray="3 2" /></svg> in your selection
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          Each point is one security at its own latest observation date — not a synchronised curve, and nothing is interpolated. Maturity is measured from today; the yield was observed on the date shown.
        </p>

        {(withheld.length > 0 || notPlotted.carriedOnly > 0 || notPlotted.neverQuoted > 0) && (
          <details className="mt-2 rounded border border-zinc-200 text-xs dark:border-zinc-800">
            <summary className="cursor-pointer px-3 py-1.5 text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400">
              Not plotted: {withheld.length} withheld for review · {notPlotted.carriedOnly} carried price only · {notPlotted.neverQuoted} never quoted
            </summary>
            <div className="space-y-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
              {withheld.length > 0 && (
                <ul className="space-y-1">
                  {withheld.map((w) => (
                    <li key={w.id}>
                      <Link href={w.href} className="font-medium text-zinc-800 hover:underline dark:text-zinc-200">
                        {w.label}
                      </Link>{" "}
                      <span className="text-orange-700 dark:text-orange-300">
                        {w.status === "REVIEW" ? "Needs review" : "Excluded"} · {w.reason}
                      </span>{" "}
                      <span className="text-zinc-400 dark:text-zinc-500">· trade {formatIsoDate(w.observationDate)} withheld from analytics</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-zinc-500 dark:text-zinc-400">
                Carried-price securities have no trade to plot (a carried price is the source re-printing an old close, not a quote); never-quoted securities have no market data at all. Both appear in the Market view and are priced hypothetically in Compare.
              </p>
            </div>
          </details>
        )}
      </div>

      <div className="lg:col-span-2">
        {selected ? (
          <SelectedCard point={selected} comparables={comparables} onClose={() => setSelectedId(null)} onSelect={setSelectedId} plottedIds={new Set(points.map((p) => p.id))} compareCta={compareCta} />
        ) : (
          <div className="rounded border border-dashed border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <p className="font-medium text-zinc-700 dark:text-zinc-300">Select a point</p>
            <p className="mt-1 text-xs">See its observed yield, last actual trade, government benchmark and potential comparables — then open the full analysis.</p>
            <p className="mt-3 text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">Reading the chart:</span> securities at a similar height yield similarly; those at a similar distance mature at a similar time. Similar yield is not similar credit or liquidity risk — higher yield can mean higher risk, a thin market or an old quote.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function rowLabel(r: ComparableRow): string {
  return r.instrumentType === "TREASURY_BILL" ? r.instrumentName : securityShortLabel(r.issuerName, r.couponRatePct ?? null, r.maturityDate);
}

function SelectedCard({
  point: p,
  comparables,
  plottedIds,
  onClose,
  onSelect,
  compareCta,
}: {
  point: LandscapePoint;
  comparables: ComparableRow[];
  plottedIds: ReadonlySet<string>;
  onClose: () => void;
  onSelect: (id: string) => void;
  compareCta: boolean;
}) {
  const target = comparables.find((c) => c.instrumentCode === p.id);
  const similar = useMemo(
    () => (target ? findComparables({ ...target, ytmPct: p.yieldPct }, comparables.filter((c) => c.instrumentCode !== p.id), "SIMILAR_RETURN").slice(0, 4) : []),
    [target, comparables, p.id, p.yieldPct],
  );

  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: GROUP_COLOR[p.group] }}>
            {LANDSCAPE_GROUP_LABEL[p.group].replace(/s$/, "")}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{p.label}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{p.issuerName}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded px-1.5 text-lg leading-none text-zinc-400 hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:text-zinc-100">
          ×
        </button>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{p.observationKind === "AUCTION_PRIMARY" ? "Auction rate" : "Observed yield"}</div>
          <div className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatPct(p.yieldPct)}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <ObservationKindBadge kind={p.observationKind} />
          <FreshnessBadge freshness={p.freshness} />
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-zinc-400 dark:text-zinc-500">{p.observationKind === "AUCTION_PRIMARY" ? "Auction date" : "Last actual trade"}</dt>
          <dd className="text-zinc-800 dark:text-zinc-200">
            {formatIsoDate(p.observationDate)}
            {p.ageDays !== null && <span className="text-zinc-400 dark:text-zinc-500"> · {p.ageDays}d ago</span>}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400 dark:text-zinc-500">Price</dt>
          <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{p.cleanPrice !== null ? p.cleanPrice.toFixed(2) : "Not reported"}</dd>
        </div>
        <div>
          <dt className="text-zinc-400 dark:text-zinc-500">{p.group === "TBILL" ? "Tenor" : "Maturity"}</dt>
          <dd className="text-zinc-800 dark:text-zinc-200">
            {p.group === "TBILL" ? formatTimeRemaining(p.tenorDays) : formatIsoDate(p.maturityDate)}
            {p.group !== "TBILL" && <span className="text-zinc-400 dark:text-zinc-500"> · {formatTimeRemaining(p.tenorDays)}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400 dark:text-zinc-500">Coupon</dt>
          <dd className="tabular-nums text-zinc-800 dark:text-zinc-200">{p.couponRatePct !== null ? formatPct(p.couponRatePct) : p.group === "TBILL" ? "Discount" : "—"}</dd>
        </div>
      </dl>

      {p.freshness === "STALE" && (
        <p className="mt-3 rounded bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          Stale: the last observation is {p.ageDays ?? "?"} days old and may not reflect today&apos;s market.
        </p>
      )}
      {p.termsConflict && (
        <p className="mt-2 rounded bg-orange-50 px-2.5 py-1.5 text-xs text-orange-900 dark:bg-orange-900/20 dark:text-orange-200">⚠ Terms conflict ({p.termsConflict}) — open the security to see the details. Scenario returns use the Securities Master terms.</p>
      )}

      {p.group === "CORPORATE" && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <BenchmarkCell ctx={p.benchmark} compact={false} align="left" />
        </div>
      )}

      {similar.length > 0 && (
        <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Potential comparables</div>
          <ul className="mt-1 space-y-1">
            {similar.map((r) => {
              const tier = comparability(r.tenorDays, [p.tenorDays]);
              const clickable = plottedIds.has(r.instrumentCode);
              const diff = Math.round((r.ytmPct! - p.yieldPct) * 100);
              return (
                <li key={r.instrumentCode} className="flex items-baseline justify-between gap-2 text-xs">
                  {clickable ? (
                    <button type="button" onClick={() => onSelect(r.instrumentCode)} className="truncate text-left font-medium text-zinc-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-200">
                      {rowLabel(r)}
                    </button>
                  ) : (
                    <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">{rowLabel(r)}</span>
                  )}
                  <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatPct(r.ytmPct!)} ({diff >= 0 ? "+" : ""}
                    {diff} bps){r.freshness === "STALE" ? " · stale" : ""}
                    <span className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-500">{tier === "SIMILAR_YIELD_AND_TENOR" ? COMPARABILITY_LABEL[tier] : "different tenor"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">Similar yield is not similar risk — credit, liquidity and data age differ.</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {p.href && (
          <Link href={p.href} className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            Analyse security →
          </Link>
        )}
        {compareCta && (
          <Link
            href={`/fixed-income/compare?codes=${encodeURIComponent(p.id)}`}
            className="rounded border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Compare &amp; scenarios
          </Link>
        )}
      </div>
    </div>
  );
}
