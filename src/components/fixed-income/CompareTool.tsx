"use client";

// ---------------------------------------------------------------------------
// Compare & Return Scenarios (M7 §13 → M7.3 §16 → M7.3.1 §17–19).
//
// Issuer-first selection: choosing an issuer selects all of its active
// bonds (refinable individually). Once a selection exists the picker
// collapses to a one-line summary so the comparison dominates the page.
//
// Results make Observed vs Hypothetical unmistakable without reading a
// paragraph: a green "Observed market" column band (real, dated, quality-
// checked observations) beside a violet, dashed "Hypothetical purchase
// price" band whose prices are edited right in its column headers. Returns
// come from computePriceSensitivity — the same engine as the security page.
//
// "Similar yields elsewhere" lists only analytics-eligible observations,
// tiered by tenor comparability (findInYieldRange), each measured against
// the nearest-tenor selected bond — yield similarity is never presented as
// equivalence.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  comparability,
  COMPARABILITY_LABEL,
  computePriceScenario,
  computePriceSensitivity,
  DEFAULT_PURCHASE_CHARGES,
  DEFAULT_SCENARIO_PRICES,
  findInYieldRange,
  formatBps,
  formatIsoDate,
  formatPct,
  formatTenorDiff,
  formatTimeRemaining,
  GFIM_BOND_TRANSACTION_LEVY,
  issuerShortName,
  MATURING_SOON_DAYS,
  NO_CHARGES,
  securityShortLabel,
  SIMILAR_RETURN_BAND_BPS,
  type Comparability,
  type ComparableRow,
  type YieldLandscape as YieldLandscapeData,
} from "@/lib/fixed-income";
import type { WorkspaceSecurity } from "@/lib/queries/fixed-income";
import { Segmented } from "./OpportunitiesTable";
import { ReturnVsPriceChart } from "./ReturnVsPriceChart";
import { YieldLandscape, type HypotheticalMarker } from "./YieldLandscape";
import { BenchmarkCell, HypotheticalBadge, LifecycleBadge, MarketStatusCell, Missing, NUM, ObservationCell, SecurityIdentity, TD, TH, TermsWarning, securityToMarketStatus, signedTone } from "./ui";

type View = "SCENARIOS" | "MARKET";

const BILLS_GROUP = "Treasury bills (BoG auction)";

/** Same 4-decimal key computePriceSensitivity de-duplicates prices with. */
function roundPrice(p: number): number {
  return Math.round(p * 10000) / 10000;
}

const OBSERVED_BAND = "bg-emerald-50/60 dark:bg-emerald-950/20";
const HYPO_BAND = "bg-violet-50/60 dark:bg-violet-950/20";

export function CompareTool({
  securities,
  bills,
  comparables,
  landscape,
  valuationDateIso,
  initialCodes,
  initialIssuers,
}: {
  /** Outstanding (non-matured) government and corporate bonds. */
  securities: WorkspaceSecurity[];
  /** Treasury bills (comparable rows) — selectable for the market view; not priced as coupon-bond scenarios. */
  bills: ComparableRow[];
  /** Full comparable universe, for the "similar yields elsewhere" panel. */
  comparables: ComparableRow[];
  /** Yield Landscape data, built server-side from the same workspace. */
  landscape: YieldLandscapeData;
  valuationDateIso: string;
  initialCodes: string[];
  initialIssuers: string[];
}) {
  // Explicit codes win; an issuer-only link selects all of that issuer's outstanding bonds.
  const [selected, setSelected] = useState<Set<string>>(() =>
    initialCodes.length > 0 ? new Set(initialCodes) : new Set(securities.filter((s) => initialIssuers.includes(s.issuerName)).map((s) => s.instrumentCode)),
  );
  const [pickerOpen, setPickerOpen] = useState(selected.size === 0);
  const [view, setView] = useState<View>("SCENARIOS");
  const [prices, setPrices] = useState<string[]>(DEFAULT_SCENARIO_PRICES.map(String));
  const [includeLevy, setIncludeLevy] = useState(true);
  const [testPrice, setTestPrice] = useState("");
  const [referenceCode, setReferenceCode] = useState("");

  const valuationDate = useMemo(() => new Date(`${valuationDateIso}T00:00:00.000Z`), [valuationDateIso]);

  // Issuers (corporates first, then GoG), each with its outstanding bonds.
  const issuers = useMemo(() => {
    const byIssuer = new Map<string, WorkspaceSecurity[]>();
    for (const s of [...securities].sort((a, b) => a.maturityDate.localeCompare(b.maturityDate))) {
      byIssuer.set(s.issuerName, [...(byIssuer.get(s.issuerName) ?? []), s]);
    }
    return [...byIssuer.entries()]
      .map(([name, bonds]) => ({ name, bonds, sovereign: bonds[0].classification === "SOVEREIGN" }))
      .sort((a, b) => Number(a.sovereign) - Number(b.sovereign) || issuerShortName(a.name).localeCompare(issuerShortName(b.name)));
  }, [securities]);

  const [openIssuers, setOpenIssuers] = useState<Set<string>>(() => new Set(issuers.filter((i) => i.bonds.some((b) => selected.has(b.instrumentCode))).map((i) => i.name)));

  function setMany(codes: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  }
  function toggleIssuer(name: string, codes: string[]) {
    const allOn = codes.every((c) => selected.has(c));
    setMany(codes, !allOn);
    setOpenIssuers((prev) => {
      const next = new Set(prev);
      if (allOn) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const selectedBonds = securities.filter((s) => selected.has(s.instrumentCode)).sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  const selectedBills = bills.filter((b) => selected.has(b.instrumentCode));

  const summary = [
    ...issuers.map((i) => ({ name: issuerShortName(i.name), n: i.bonds.filter((b) => selected.has(b.instrumentCode)).length })),
    { name: "T-bills", n: selectedBills.length },
  ].filter((x) => x.n > 0);

  const scenarioPrices = prices.map((p) => Number(p)).filter((p) => Number.isFinite(p) && p > 0);
  const charges = includeLevy ? DEFAULT_PURCHASE_CHARGES : NO_CHARGES;

  // Cheap enough to recompute every render (≤ a few dozen bonds × a few prices).
  const scenarioRows = selectedBonds.map((s) => {
    const sens = computePriceSensitivity(s.terms, valuationDate, scenarioPrices, charges);
    const byPrice = new Map<number, number | null>();
    if (sens.ok) for (const sc of sens.scenarios) byPrice.set(roundPrice(sc.cleanPrice), sc.returnPct);
    const firstScenario = scenarioPrices.length > 0 ? (byPrice.get(roundPrice(scenarioPrices[0])) ?? null) : null;
    // Reference yield for relative value: a reliable observed YTM, else the hypothetical return at the first scenario price.
    const reference = s.analyticsEligible ? { yieldPct: s.analytics.ytmPct!, hypothetical: false } : firstScenario !== null ? { yieldPct: firstScenario, hypothetical: true } : null;
    return { s, sens, byPrice, reference };
  });

  const withReference = scenarioRows.filter((r) => r.reference !== null);
  const band = withReference.length
    ? { lo: Math.min(...withReference.map((r) => r.reference!.yieldPct)), hi: Math.max(...withReference.map((r) => r.reference!.yieldPct)) }
    : null;
  const similar = band ? findInYieldRange(comparables, band.lo, band.hi, selected, SIMILAR_RETURN_BAND_BPS, withReference.map((r) => r.s.analytics.tenorDays)).slice(0, 14) : [];
  const nearestSelected = (tenorDays: number) =>
    withReference.reduce((best, r) => (Math.abs(r.s.analytics.tenorDays - tenorDays) < Math.abs(best.s.analytics.tenorDays - tenorDays) ? r : best), withReference[0]);

  // Hypothetical markers for the landscape: each selected bond's return at the tested price (else the first scenario price), from the same engine.
  const testNum = Number(testPrice);
  const markerPrice = testPrice.trim() !== "" && Number.isFinite(testNum) && testNum > 0 ? testNum : (scenarioPrices[0] ?? null);
  const hypotheticals: HypotheticalMarker[] =
    markerPrice === null
      ? []
      : selectedBonds
          .filter((b) => b.analytics.tenorDays > MATURING_SOON_DAYS)
          .flatMap((b) => {
            const sc = computePriceScenario(b.terms, valuationDate, markerPrice, charges);
            return sc.ok && sc.returnPct !== null
              ? [{ id: b.instrumentCode, label: securityShortLabel(b.issuerName, b.couponRatePct, b.maturityDate), tenorDays: b.analytics.tenorDays, returnPct: sc.returnPct, price: markerPrice }]
              : [];
          });

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ selection */}
      {!pickerOpen && selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="text-zinc-500 dark:text-zinc-400">Comparing </span>
            {summary.map((x, i) => (
              <span key={x.name}>
                {i > 0 && <span className="text-zinc-400"> · </span>}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{x.name}</span> <span className="tabular-nums text-zinc-500">({x.n})</span>
              </span>
            ))}
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Change selection
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">1 · Choose issuers</p>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">Choosing an issuer selects all of its active bonds. Matured bonds are in the universe&apos;s Historical view.</p>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Issuers">
              {issuers.map((i) => {
                const codes = i.bonds.map((b) => b.instrumentCode);
                const n = codes.filter((c) => selected.has(c)).length;
                const state = n === 0 ? "none" : n === codes.length ? "all" : "some";
                return (
                  <button
                    key={i.name}
                    type="button"
                    title={i.name}
                    aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
                    onClick={() => toggleIssuer(i.name, codes)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                      state === "all"
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : state === "some"
                          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                          : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {issuerShortName(i.name)} <span className="opacity-60">{state === "some" ? `${n}/${codes.length}` : codes.length}</span>
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={openIssuers.has(BILLS_GROUP)}
                onClick={() => setOpenIssuers((prev) => new Set(prev.has(BILLS_GROUP) ? [...prev].filter((x) => x !== BILLS_GROUP) : [...prev, BILLS_GROUP]))}
                className="rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                T-bills…
              </button>
            </div>
          </div>

          {openIssuers.size > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">2 · Refine securities</p>
              <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {issuers
                  .filter((i) => openIssuers.has(i.name))
                  .map((i) => (
                    <fieldset key={i.name} className="rounded border border-zinc-200 p-2.5 dark:border-zinc-800">
                      <legend className="px-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{issuerShortName(i.name)}</legend>
                      {i.bonds.map((b) => (
                        <label key={b.instrumentCode} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                          <input type="checkbox" checked={selected.has(b.instrumentCode)} onChange={(e) => setMany([b.instrumentCode], e.target.checked)} />
                          <span className="truncate text-zinc-900 dark:text-zinc-100">{securityShortLabel(b.issuerName, b.couponRatePct, b.maturityDate)}</span>
                          <span className="ml-auto shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500">{b.analyticsEligible ? "traded" : b.latestObservationDate ? "review" : "no trade"}</span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                {openIssuers.has(BILLS_GROUP) && (
                  <fieldset className="rounded border border-zinc-200 p-2.5 dark:border-zinc-800">
                    <legend className="px-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{BILLS_GROUP}</legend>
                    {bills.map((b) => (
                      <label key={b.instrumentCode} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                        <input type="checkbox" checked={selected.has(b.instrumentCode)} onChange={(e) => setMany([b.instrumentCode], e.target.checked)} />
                        <span className="text-zinc-900 dark:text-zinc-100">{b.instrumentName}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{selected.size}</span> selected
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelected(new Set())} className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Clear
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setPickerOpen(false)}
                className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                Compare {selected.size > 0 ? selected.size : ""} →
              </button>
            </div>
          </div>
        </div>
      )}

      {selected.size === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">Choose one or more issuers above — e.g. Bayport and Kasapreko — to compare all their active bonds.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "SCENARIOS", label: "Return Scenarios" },
                { value: "MARKET", label: "Market & Risk" },
              ]}
            />
            {view === "SCENARIOS" && (
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400" title={GFIM_BOND_TRANSACTION_LEVY.basis}>
                <input type="checkbox" checked={includeLevy} onChange={(e) => setIncludeLevy(e.target.checked)} />
                Include {GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC levy in scenario returns
              </label>
            )}
          </div>

          {view === "SCENARIOS" ? (
            <>
              {selectedBonds.length === 0 ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">Return scenarios apply to coupon bonds — the selected Treasury bills appear under Market &amp; Risk.</p>
              ) : (
                <section aria-label="Return scenarios">
                  <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                    <table className="w-full min-w-[800px] text-left text-sm">
                      <thead>
                        <tr>
                          <th className={`${TH} border-b border-zinc-200 dark:border-zinc-800`} rowSpan={2}>
                            Security · maturity
                          </th>
                          <th className={`${TH} ${OBSERVED_BAND} border-l border-zinc-200 text-center text-emerald-800 dark:border-zinc-800 dark:text-emerald-300`} colSpan={2}>
                            Observed market <span className="font-normal normal-case tracking-normal">· real, dated</span>
                          </th>
                          <th
                            className={`${TH} ${HYPO_BAND} border-l-2 border-dashed border-violet-300 text-center text-violet-800 dark:border-violet-700 dark:text-violet-300`}
                            colSpan={prices.length || 1}
                          >
                            Hypothetical purchase price → annualized return <span className="font-normal normal-case tracking-normal">· your assumption, not a market price · edit prices</span>
                          </th>
                          <th className={`${TH} border-b border-l border-zinc-200 text-right dark:border-zinc-800`} rowSpan={2}>
                            Government benchmark
                          </th>
                        </tr>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800">
                          <th className={`${TH} ${OBSERVED_BAND} border-l border-zinc-200 text-right dark:border-zinc-800`}>Last price</th>
                          <th className={`${TH} ${OBSERVED_BAND} text-right`}>YTM</th>
                          {prices.map((p, i) => (
                            <th key={i} className={`${TH} ${HYPO_BAND} text-right ${i === 0 ? "border-l-2 border-dashed border-violet-300 dark:border-violet-700" : ""}`}>
                              <label className="inline-flex items-center gap-1">
                                <span aria-hidden>@</span>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0"
                                  value={p}
                                  onChange={(e) => setPrices((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                                  aria-label={`Hypothetical clean price ${i + 1}`}
                                  className="w-16 rounded border border-violet-200 bg-white px-1.5 py-0.5 text-right text-xs tabular-nums text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 dark:border-violet-800 dark:bg-zinc-900 dark:text-zinc-100"
                                />
                              </label>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {scenarioRows.map(({ s, sens, byPrice }) => (
                          <tr key={s.instrumentCode} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60 dark:border-zinc-800/50 dark:hover:bg-zinc-800/30">
                            <td className={TD}>
                              <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
                              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                {formatIsoDate(s.maturityDate)} · {formatTimeRemaining(s.analytics.tenorDays)} <LifecycleBadge lifecycle={s.lifecycle} />
                                <TermsWarning issues={s.termsIssues} />
                              </div>
                            </td>
                            <td className={`${NUM} ${OBSERVED_BAND} border-l border-zinc-100 dark:border-zinc-800`}>
                              {s.latestObservationDate && s.analytics.cleanPrice !== null ? <span className="text-zinc-900 dark:text-zinc-100">{s.analytics.cleanPrice.toFixed(2)}</span> : null}
                              <div className="mt-0.5">
                                <MarketStatusCell s={securityToMarketStatus(s)} />
                              </div>
                            </td>
                            <td className={`${NUM} ${OBSERVED_BAND} text-base font-semibold`}>
                              {s.analytics.ytmPct === null ? (
                                <Missing reason="No market yield: no trade or quote has been observed." />
                              ) : s.analyticsEligible ? (
                                <span className="text-emerald-900 dark:text-emerald-200">{formatPct(s.analytics.ytmPct)}</span>
                              ) : (
                                <span className="cursor-help text-zinc-400 line-through" title="Withheld from analytics pending data-quality review.">
                                  {formatPct(s.analytics.ytmPct)}
                                </span>
                              )}
                            </td>
                            {prices.map((raw, i) => {
                              const p = Number(raw);
                              const valid = Number.isFinite(p) && p > 0;
                              const ret = valid ? byPrice.get(roundPrice(p)) : undefined;
                              return (
                                <td
                                  key={i}
                                  className={`${NUM} ${HYPO_BAND} font-semibold ${i === 0 ? "border-l-2 border-dashed border-violet-300 dark:border-violet-700" : ""} ${ret != null ? signedTone(ret) : ""}`}
                                >
                                  {!valid ? "—" : !sens.ok ? <Missing reason={sens.message} /> : ret != null ? formatPct(ret) : "—"}
                                </td>
                              );
                            })}
                            <td className="w-44 border-l border-zinc-100 px-3 py-2 text-right tabular-nums text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                              <BenchmarkCell ctx={s.benchmarkContext} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                    Hypothetical returns: clean price + accrued interest as of {formatIsoDate(valuationDateIso)}
                    {includeLevy ? ` + ${GFIM_BOND_TRANSACTION_LEVY.ratePct}% SEC levy` : ""}, held to maturity, gross of tax. Observed YTM is solved at its own trade date. An{" "}
                    <em>observed spread</em> compares a real trade with a date-matched government yield; for a bond with no reliable market yield the benchmark column shows a{" "}
                    <em>reference</em> government yield — today&apos;s nearest tenor, context for the hypothetical returns only. No spread exists for it.
                  </p>
                </section>
              )}

              {selectedBonds.length > 0 && (
                <section aria-label="Purchase price versus return">
                  <h3 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-violet-800 dark:text-violet-300">
                    What price do we need? <HypotheticalBadge />
                  </h3>
                  <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
                    Annualized hold-to-maturity return at any purchase price you choose, using the same engine as the table above. Add a reference yield to see the highest price that still matches it.
                  </p>
                  <ReturnVsPriceChart
                    bonds={selectedBonds}
                    valuationDate={valuationDate}
                    charges={charges}
                    comparables={comparables}
                    testPrice={testPrice}
                    onTestPriceChange={setTestPrice}
                    referenceCode={referenceCode}
                    onReferenceChange={setReferenceCode}
                    onAddScenario={(p) => setPrices((prev) => (prev.length >= 6 || prev.some((x) => Number(x) === p) ? prev : [...prev, String(p)]))}
                  />
                </section>
              )}

              <section aria-label="Where the selection sits in the market">
                <h3 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Where your selection sits in the market</h3>
                <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
                  Ringed points are your selected bonds&apos; observed yields (where reliable). Violet diamonds are <em>hypothetical</em> returns at {markerPrice !== null ? `a price of ${markerPrice}` : "your price"}
                  {testPrice.trim() === "" ? " (the first scenario price)" : ""} — not observations.
                </p>
                <YieldLandscape
                  points={landscape.points}
                  withheld={landscape.withheld}
                  notPlotted={landscape.notPlotted}
                  comparables={comparables}
                  highlightIds={selected}
                  hypotheticals={hypotheticals}
                  height={300}
                  compareCta={false}
                />
              </section>

              {band && (
                <section aria-label="Similar yields elsewhere">
                  <h3 className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Similar yields elsewhere in the market</h3>
                  <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
                    Reliable observed yields within {formatPct(band.lo)}–{formatPct(band.hi)} ±{SIMILAR_RETURN_BAND_BPS} bps (the selection&apos;s observed YTMs, or its return at{" "}
                    {scenarioPrices[0] ?? 100} where it has none). Potential comparables only — similar yield is not similar risk.
                  </p>
                  {similar.length === 0 ? (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500">No other outstanding security has a reliable observed yield in this range.</p>
                  ) : (
                    <SimilarTable rows={similar} referenceTenors={withReference.map((r) => r.s.analytics.tenorDays)} nearest={nearestSelected} />
                  )}
                </section>
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

function SimilarTable({
  rows,
  referenceTenors,
  nearest,
}: {
  rows: ComparableRow[];
  referenceTenors: number[];
  nearest: (tenorDays: number) => { s: WorkspaceSecurity; reference: { yieldPct: number; hypothetical: boolean } | null };
}) {
  const groups = (["SIMILAR_YIELD_AND_TENOR", "SIMILAR_YIELD_DIFFERENT_TENOR"] as Comparability[]).map((c) => ({ c, rows: rows.filter((r) => comparability(r.tenorDays, referenceTenors) === c) }));
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className={TH}>Potential comparable</th>
            <th className={`${TH} text-right`}>Observed YTM</th>
            <th className={`${TH} text-right`}>vs nearest-tenor selected bond</th>
            <th className={`${TH} text-right`}>Maturity</th>
            <th className={`${TH} text-right`}>Mod. duration</th>
            <th className={`${TH} text-right`}>Last market observation</th>
          </tr>
        </thead>
        {groups
          .filter((g) => g.rows.length > 0)
          .map((g) => (
            <tbody key={g.c}>
              <tr>
                <td colSpan={6} className="bg-zinc-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/40 dark:text-zinc-400">
                  {COMPARABILITY_LABEL[g.c]}{" "}
                  <span className="font-normal normal-case tracking-normal">
                    · {g.c === "SIMILAR_YIELD_AND_TENOR" ? "maturity within 1 year of a selected bond's" : "maturity more than 1 year from every selected bond's"}
                  </span>
                </td>
              </tr>
              {g.rows.map((r) => {
                const ref = nearest(r.tenorDays);
                const yieldDiff = ref.reference ? Math.round((r.ytmPct! - ref.reference.yieldPct) * 100) : null;
                const isBill = r.instrumentType === "TREASURY_BILL";
                return (
                  <tr key={r.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
                    <td className={TD}>
                      {isBill ? (
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">{r.instrumentName}</span>
                      ) : (
                        <SecurityIdentity instrumentCode={r.instrumentCode} issuerName={r.issuerName} couponRatePct={r.couponRatePct ?? null} maturityDate={r.maturityDate} />
                      )}
                      <span className={`text-[10px] font-medium ${r.classification === "SOVEREIGN" ? "text-blue-700 dark:text-blue-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                        {r.classification === "SOVEREIGN" ? (isBill ? "Sovereign · T-bill" : "Sovereign") : "Corporate"}
                      </span>
                    </td>
                    <td className={`${NUM} text-base font-semibold text-zinc-900 dark:text-zinc-100`}>{formatPct(r.ytmPct!)}</td>
                    <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                      {yieldDiff !== null ? formatBps(yieldDiff) : "—"} · {formatTenorDiff(r.tenorDays - ref.s.analytics.tenorDays)}
                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        vs {securityShortLabel(ref.s.issuerName, ref.s.couponRatePct, ref.s.maturityDate)}
                        {ref.reference?.hypothetical ? " (hypothetical)" : ""}
                      </div>
                    </td>
                    <td className={`${NUM} text-zinc-700 dark:text-zinc-300`}>
                      {formatIsoDate(r.maturityDate)}
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatTimeRemaining(r.tenorDays)}</div>
                    </td>
                    <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{r.modifiedDurationYears !== null ? `${r.modifiedDurationYears.toFixed(2)}y` : "—"}</td>
                    <td className={`${TD} text-right`}>
                      <ObservationCell dateIso={r.observationDate} kind={r.observationKind} freshness={r.freshness} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
      </table>
    </div>
  );
}

function MarketTable({ bonds, bills }: { bonds: WorkspaceSecurity[]; bills: ComparableRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-800">
            <th className={TH}>Security</th>
            <th className={`${TH} text-right`}>Observed YTM</th>
            <th className={`${TH} text-right`}>Current yield</th>
            <th className={`${TH} text-right`}>Maturity</th>
            <th className={`${TH} text-right`}>Mod. duration</th>
            <th className={`${TH} text-right`}>DV01</th>
            <th className={`${TH} text-right`}>Last market observation</th>
          </tr>
        </thead>
        <tbody>
          {bonds.map((s) => (
            <tr key={s.instrumentCode} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className={TD}>
                <SecurityIdentity instrumentCode={s.instrumentCode} issuerName={s.issuerName} couponRatePct={s.couponRatePct} maturityDate={s.maturityDate} />
              </td>
              <td className={`${NUM} font-semibold text-zinc-900 dark:text-zinc-100`}>{s.analyticsEligible ? formatPct(s.analytics.ytmPct!) : <Missing reason="No reliable market yield." />}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.analyticsEligible && s.analytics.currentYieldPct !== null ? formatPct(s.analytics.currentYieldPct) : "—"}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>
                {formatIsoDate(s.maturityDate)}
                <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{formatTimeRemaining(s.analytics.tenorDays)}</div>
              </td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.analyticsEligible && s.analytics.modifiedDurationYears !== null ? `${s.analytics.modifiedDurationYears.toFixed(2)}y` : "—"}</td>
              <td className={`${NUM} text-zinc-600 dark:text-zinc-400`}>{s.analyticsEligible && s.analytics.dv01 !== null ? s.analytics.dv01.toFixed(4) : "—"}</td>
              <td className={`${TD} text-right`}>
                <MarketStatusCell s={securityToMarketStatus(s)} />
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
              <td className={`${TD} text-right`}>
                <ObservationCell dateIso={b.observationDate} kind={b.observationKind} freshness={b.freshness} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-zinc-400 dark:text-zinc-500">Duration and DV01 are shown only where the observed yield passed every data-quality check.</p>
    </div>
  );
}
