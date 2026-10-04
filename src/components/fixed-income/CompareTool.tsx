"use client";

// ---------------------------------------------------------------------------
// Compare & Return Scenarios (M7 §13, rebuilt for M7.3 §16/§17/§31).
//
// 1. Filter the OUTSTANDING universe (issuer / type / quote availability)
//    and select securities — individually or "all shown", so "the active
//    Bayport and Kasapreko bonds" is two clicks, not a list of ISINs.
// 2. Return Scenarios: annualized hold-to-maturity return for each selected
//    bond at three editable hypothetical prices (default 100/105/110),
//    next to the latest OBSERVED price/yield — via computePriceSensitivity,
//    the same engine as the security page.
// 3. Similar returns elsewhere: outstanding securities whose observed yield
//    lies within the selection's return band (findInYieldRange).
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  computePriceSensitivity,
  DEFAULT_PURCHASE_CHARGES,
  DEFAULT_SCENARIO_PRICES,
  findInYieldRange,
  formatBps,
  formatIsoDate,
  formatPct,
  formatTimeRemaining,
  GFIM_BOND_TRANSACTION_LEVY,
  issuerShortName,
  NO_CHARGES,
  securityShortLabel,
  SIMILAR_RETURN_BAND_BPS,
  type ComparableRow,
} from "@/lib/fixed-income";
import type { WorkspaceSecurity } from "@/lib/queries/fixed-income";
import { Segmented } from "./OpportunitiesTable";
import { HypotheticalBadge, LifecycleBadge, Missing, NUM, ObservationCell, SecurityIdentity, TD, TH, signedTone } from "./ui";

type TypeFilter = "ALL" | "CORPORATE" | "SOVEREIGN";
type View = "SCENARIOS" | "MARKET";

/** Same 4-decimal key computePriceSensitivity de-duplicates prices with. */
function roundPrice(p: number): number {
  return Math.round(p * 10000) / 10000;
}

export function CompareTool({
  securities,
  bills,
  comparables,
  valuationDateIso,
  initialCodes,
  initialIssuers,
}: {
  /** Outstanding (non-matured) government and corporate bonds. */
  securities: WorkspaceSecurity[];
  /** Treasury bills (comparable rows) — selectable for the market view; not priced as coupon-bond scenarios. */
  bills: ComparableRow[];
  /** Full comparable universe, for the "similar returns elsewhere" panel. */
  comparables: ComparableRow[];
  valuationDateIso: string;
  initialCodes: string[];
  initialIssuers: string[];
}) {
  const [type, setType] = useState<TypeFilter>(initialIssuers.length > 0 || initialCodes.length > 0 ? "ALL" : "CORPORATE");
  const [issuers, setIssuers] = useState<Set<string>>(new Set(initialIssuers));
  const [quotedOnly, setQuotedOnly] = useState(false);
  // Explicit codes win; an issuer-only link (from a security page) selects all of that issuer's outstanding bonds.
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialCodes.length > 0 ? new Set(initialCodes) : new Set(securities.filter((s) => initialIssuers.includes(s.issuerName)).map((s) => s.instrumentCode)),
  );
  const [view, setView] = useState<View>("SCENARIOS");
  const [prices, setPrices] = useState<string[]>(DEFAULT_SCENARIO_PRICES.map(String));
  const [includeLevy, setIncludeLevy] = useState(true);

  const valuationDate = useMemo(() => new Date(`${valuationDateIso}T00:00:00.000Z`), [valuationDateIso]);

  const issuerOptions = useMemo(() => {
    const names = new Set(securities.filter((s) => type === "ALL" || s.classification === type).map((s) => s.issuerName));
    return [...names].sort((a, b) => issuerShortName(a).localeCompare(issuerShortName(b)));
  }, [securities, type]);

  const candidates = useMemo(
    () =>
      securities
        .filter((s) => (type === "ALL" || s.classification === type) && (issuers.size === 0 || issuers.has(s.issuerName)) && (!quotedOnly || s.latestObservationDate !== null))
        .sort((a, b) => a.issuerName.localeCompare(b.issuerName) || a.maturityDate.localeCompare(b.maturityDate)),
    [securities, type, issuers, quotedOnly],
  );
  const billCandidates = type !== "CORPORATE" && issuers.size === 0 ? bills : [];

  const selectedBonds = securities.filter((s) => selected.has(s.instrumentCode)).sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  const selectedBills = bills.filter((b) => selected.has(b.instrumentCode));

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }
  function toggleIssuer(name: string) {
    setIssuers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const scenarioPrices = prices.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
  const charges = includeLevy ? DEFAULT_PURCHASE_CHARGES : NO_CHARGES;

  // Cheap enough to recompute every render (≤ a dozen bonds × a few prices), so no memoisation.
  const scenarioRows = selectedBonds.map((s) => {
    const sens = computePriceSensitivity(s.terms, valuationDate, scenarioPrices, charges);
    const byPrice = new Map<number, number | null>();
    if (sens.ok) for (const sc of sens.scenarios) byPrice.set(roundPrice(sc.cleanPrice), sc.returnPct);
    return { s, sens, byPrice };
  });

  // Return band for "similar returns elsewhere": the selection's observed YTMs, or — where a bond has no market yield — its return at the FIRST scenario price (default 100).
  const bandValues = scenarioRows.flatMap((r) => {
    if (r.s.analytics.ytmPct !== null) return [r.s.analytics.ytmPct];
    const first = scenarioPrices.length > 0 ? r.byPrice.get(roundPrice(scenarioPrices[0])) : null;
    return first != null ? [first] : [];
  });
  const band = bandValues.length ? { lo: Math.min(...bandValues), hi: Math.max(...bandValues) } : null;
  const similar = band ? findInYieldRange(comparables, band.lo, band.hi, selected).slice(0, 12) : [];

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ selection */}
      <div className="space-y-2 rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={type}
            onChange={(v) => {
              setType(v);
              setIssuers(new Set());
            }}
            options={[
              { value: "CORPORATE", label: "Corporate" },
              { value: "SOVEREIGN", label: "Government" },
              { value: "ALL", label: "All" },
            ]}
          />
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={quotedOnly} onChange={(e) => setQuotedOnly(e.target.checked)} />
            With market observation
          </label>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">Active securities only — matured instruments are in the universe&apos;s Historical view.</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Issuer</span>
          {issuerOptions.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              onClick={() => toggleIssuer(name)}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                issuers.has(name)
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {issuerShortName(name)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {candidates.length + billCandidates.length} shown · <span className="font-medium text-zinc-900 dark:text-zinc-100">{selected.size} selected</span>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelected((prev) => new Set([...prev, ...candidates.map((c) => c.instrumentCode)]))}
              className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Select all shown bonds
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="rounded px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              Clear selection
            </button>
          </div>
        </div>
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((s) => (
            <label key={s.instrumentCode} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
              <input type="checkbox" checked={selected.has(s.instrumentCode)} onChange={() => toggle(s.instrumentCode)} className="shrink-0" />
              <span className="truncate">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{securityShortLabel(s.issuerName, s.couponRatePct, s.maturityDate)}</span>{" "}
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">{s.latestObservationDate ? "quoted" : "no quote"}</span>
              </span>
            </label>
          ))}
          {billCandidates.map((b) => (
            <label key={b.instrumentCode} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
              <input type="checkbox" checked={selected.has(b.instrumentCode)} onChange={() => toggle(b.instrumentCode)} className="shrink-0" />
              <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{b.instrumentName}</span>
            </label>
          ))}
        </div>
      </div>

      {selected.size === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">Select securities above — or pick issuers and use “Select all shown bonds”.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "SCENARIOS", label: "Return Scenarios" },
                { value: "MARKET", label: "Market & Risk Analytics" },
              ]}
            />
            {view === "SCENARIOS" && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span>Hypothetical prices</span>
                {prices.map((p, i) => (
                  <input
                    key={i}
                    type="number"
                    step="0.5"
                    min="0"
                    value={p}
                    onChange={(e) => setPrices((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                    className="w-20 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs tabular-nums text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    aria-label={`Scenario price ${i + 1}`}
                  />
                ))}
                <button type="button" onClick={() => setPrices(DEFAULT_SCENARIO_PRICES.map(String))} className="text-zinc-400 underline hover:text-zinc-700 dark:hover:text-zinc-300">
                  reset
                </button>
                <label className="ml-2 flex items-center gap-1.5" title={GFIM_BOND_TRANSACTION_LEVY.basis}>
                  <input type="checkbox" checked={includeLevy} onChange={(e) => setIncludeLevy(e.target.checked)} />
                  {GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC levy
                </label>
              </div>
            )}
          </div>

          {view === "SCENARIOS" ? (
            <>
              {selectedBonds.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">Return scenarios apply to coupon bonds — the selected Treasury bills appear under Market &amp; Risk Analytics.</p>
              ) : (
                <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className={TH} rowSpan={2}>
                          Security · coupon
                        </th>
                        <th className={`${TH} text-right`} rowSpan={2}>
                          Principal repaid
                        </th>
                        <th className={`${TH} border-l border-zinc-200 text-center text-emerald-700 dark:border-zinc-800 dark:text-emerald-400`} colSpan={2}>
                          Latest observed
                        </th>
                        <th className={`${TH} border-l border-zinc-200 text-center text-violet-700 dark:border-zinc-800 dark:text-violet-300`} colSpan={scenarioPrices.length}>
                          Annualized HTM return at hypothetical price
                        </th>
                        <th className={`${TH} border-l border-zinc-200 text-right dark:border-zinc-800`} rowSpan={2}>
                          Spread vs GoG
                        </th>
                      </tr>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800">
                        <th className={`${TH} border-l border-zinc-200 text-right dark:border-zinc-800`}>Price · date</th>
                        <th className={`${TH} text-right`}>YTM</th>
                        {scenarioPrices.map((p, i) => (
                          <th key={i} className={`${TH} text-right ${i === 0 ? "border-l border-zinc-200 dark:border-zinc-800" : ""}`}>
                            @ {p.toFixed(p % 1 === 0 ? 0 : 2)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scenarioRows.map(({ s, sens, byPrice }) => (
                        <tr key={s.instrumentCode} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                          <td className={TD}>
                            <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
                          </td>
                          <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                            {formatIsoDate(s.maturityDate)}
                            <div className="flex items-center justify-end gap-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                              <LifecycleBadge lifecycle={s.lifecycle} />
                              {formatTimeRemaining(s.analytics.tenorDays)}
                            </div>
                          </td>
                          <td className={`${NUM} border-l border-zinc-100 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300`}>
                            {s.latestObservationDate ? (
                              <>
                                {s.analytics.cleanPrice !== null ? s.analytics.cleanPrice.toFixed(2) : <Missing short="Not reported" reason="The observation reports a yield but no price." />}
                                <div className="mt-0.5">
                                  <ObservationCell dateIso={s.latestObservationDate} kind={s.analytics.observationKind} freshness={s.observationFreshness} />
                                </div>
                              </>
                            ) : (
                              <Missing short="No market quote" reason="No market price or yield has been observed for this security." />
                            )}
                          </td>
                          <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>
                            {s.analytics.ytmPct !== null ? formatPct(s.analytics.ytmPct) : <Missing reason="Yield unavailable because no market price or yield exists." />}
                          </td>
                          {scenarioPrices.map((p, i) => {
                            const ret = byPrice.get(roundPrice(p));
                            return (
                              <td key={i} className={`${NUM} font-semibold ${i === 0 ? "border-l border-zinc-100 dark:border-zinc-800" : ""} ${ret != null ? signedTone(ret) : ""}`}>
                                {!sens.ok ? <Missing reason={sens.message} /> : ret != null ? formatPct(ret) : "—"}
                              </td>
                            );
                          })}
                          <td className={`${NUM} border-l border-zinc-100 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300`}>
                            {s.classification === "SOVEREIGN" ? (
                              <span className="text-xs text-zinc-400 dark:text-zinc-500">Sovereign</span>
                            ) : s.benchmark ? (
                              <span title={`${s.benchmark.benchmark.instrumentLabel} · ${s.benchmark.benchmark.observationKind === "SECONDARY_MARKET" ? "secondary" : "primary"} · ${formatIsoDate(s.benchmark.benchmark.observationDate)} · tenor gap ${s.benchmark.tenorGapDays}d`}>
                                {s.spreadBps !== null ? formatBps(s.spreadBps) : <Missing short="—" reason="Spread needs an observed yield." />}
                                <div className={`text-[10px] ${s.benchmark.isWideGap ? "text-amber-600 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"}`}>
                                  GoG {formatPct(s.benchmark.benchmark.yieldPct)} · gap {s.benchmark.tenorGapDays}d
                                </div>
                              </span>
                            ) : (
                              <Missing reason="No suitable sovereign benchmark exists." />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <HypotheticalBadge /> Scenario columns are hypothetical purchase prices, not dealer quotes. Each return is the annualized hold-to-maturity return on clean price + accrued
                interest as of {formatIsoDate(valuationDateIso)}
                {includeLevy ? ` + ${GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC levy` : ""}, gross of tax. “Latest observed” columns are real market observations, with their dates.
              </p>

              {band && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Similar returns elsewhere in the market
                    <span className="ml-2 font-normal normal-case tracking-normal text-zinc-400 dark:text-zinc-500">
                      observed yields within {formatPct(band.lo)}–{formatPct(band.hi)} ±{SIMILAR_RETURN_BAND_BPS} bps (the selection&apos;s observed YTMs, or return at {scenarioPrices[0] ?? 100} where unquoted)
                    </span>
                  </h3>
                  {similar.length === 0 ? (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">No other outstanding security has an observed yield in this range.</p>
                  ) : (
                    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-zinc-200 dark:border-zinc-800">
                            <th className={TH}>Security</th>
                            <th className={`${TH} text-right`}>Observed YTM</th>
                            <th className={`${TH} text-right`}>Maturity</th>
                            <th className={`${TH} text-right`}>Spread vs GoG</th>
                            <th className={`${TH} text-right`}>Observation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {similar.map((r) => (
                            <tr key={r.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                              <td className={TD}>
                                {r.instrumentType === "TREASURY_BILL" ? (
                                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.instrumentName}</span>
                                ) : (
                                  <SecurityIdentity instrumentCode={r.instrumentCode} issuerName={r.issuerName} couponRatePct={r.couponRatePct ?? null} maturityDate={r.maturityDate} />
                                )}
                                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{r.classification === "SOVEREIGN" ? "Sovereign" : "Corporate"}</span>
                              </td>
                              <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>{formatPct(r.ytmPct!)}</td>
                              <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                                {formatIsoDate(r.maturityDate)}
                                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatTimeRemaining(r.tenorDays)}</div>
                              </td>
                              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{r.spreadBps !== null ? formatBps(r.spreadBps) : r.classification === "SOVEREIGN" ? "n/a" : "—"}</td>
                              <td className={`${TD} text-right`}>
                                <ObservationCell dateIso={r.observationDate} kind={r.observationKind} freshness={r.freshness} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">Relative-value information only — similar yields do not imply similar credit risk, liquidity, or tenor.</p>
                </div>
              )}
            </>
          ) : (
            <MarketTable bonds={selectedBonds} bills={selectedBills} />
          )}
        </>
      )}
    </div>
  );
}

function MarketTable({ bonds, bills }: { bonds: WorkspaceSecurity[]; bills: ComparableRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className={TH}>Security</th>
            <th className={`${TH} text-right`}>Observed YTM</th>
            <th className={`${TH} text-right`}>Current yield</th>
            <th className={`${TH} text-right`}>Maturity</th>
            <th className={`${TH} text-right`}>Mod. duration</th>
            <th className={`${TH} text-right`}>DV01</th>
            <th className={`${TH} text-right`}>Spread vs GoG</th>
            <th className={`${TH} text-right`}>Observation</th>
          </tr>
        </thead>
        <tbody>
          {bonds.map((s) => (
            <tr key={s.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className={TD}>
                <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
              </td>
              <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>{s.analytics.ytmPct !== null ? formatPct(s.analytics.ytmPct) : <Missing reason="No market price or yield observed." />}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.analytics.currentYieldPct !== null ? formatPct(s.analytics.currentYieldPct) : <Missing reason="Requires an observed price." />}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>
                {formatIsoDate(s.maturityDate)}
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatTimeRemaining(s.analytics.tenorDays)}</div>
              </td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.analytics.modifiedDurationYears !== null ? `${s.analytics.modifiedDurationYears.toFixed(2)}y` : <Missing reason="Requires an observed price or yield." />}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.analytics.dv01 !== null ? s.analytics.dv01.toFixed(4) : <Missing reason="Requires an observed price or yield." />}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.spreadBps !== null ? formatBps(s.spreadBps) : s.classification === "SOVEREIGN" ? "n/a" : <Missing reason="Spread needs an observed yield and a sovereign benchmark." />}</td>
              <td className={`${TD} text-right`}>
                <ObservationCell dateIso={s.latestObservationDate} kind={s.analytics.observationKind} freshness={s.observationFreshness} />
              </td>
            </tr>
          ))}
          {bills.map((b) => (
            <tr key={b.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className={`${TD} font-medium text-zinc-900 dark:text-zinc-100`}>
                {b.instrumentName}
                <div className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500">Government of Ghana · BoG auction</div>
              </td>
              <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>{b.ytmPct !== null ? formatPct(b.ytmPct) : "—"}</td>
              <td className={`${NUM} text-zinc-400`}>n/a</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{formatTimeRemaining(b.tenorDays)} tenor</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{b.modifiedDurationYears !== null ? `${b.modifiedDurationYears.toFixed(2)}y` : "—"}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{b.dv01 !== null ? b.dv01.toFixed(4) : "—"}</td>
              <td className={`${NUM} text-zinc-400`}>n/a</td>
              <td className={`${TD} text-right`}>
                <ObservationCell dateIso={b.observationDate} kind={b.observationKind} freshness={b.freshness} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">
        <Link href="/fixed-income" className="underline">
          Back to the universe
        </Link>{" "}
        · Duration and DV01 are computed at each security&apos;s observed yield.
      </p>
    </div>
  );
}
