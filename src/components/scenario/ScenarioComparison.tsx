// ---------------------------------------------------------------------------
// Scenario comparison presentation (M8.4). Labelling and layout only — figures
// come from buildComparison, which reads each scenario's M8.3 result. Cards
// (not a spreadsheet) so it reads on a phone: outcome first, then the drivers,
// then the assumptions that produced them.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { EXPOSURE_ASSET_CLASS_LABEL, EXPOSURE_ASSET_CLASS_ORDER } from "@/lib/portfolio";
import { formatIsoDate } from "@/lib/fixed-income";
import { NO_ASSUMPTION_TEXT, signedGhsWhole, type Comparison } from "@/lib/scenario-studio";
import { DivergingBar, impactTone } from "./ScenarioStudio";

const CARD = "rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";
const SERIES = ["bg-sky-500/80", "bg-violet-500/80", "bg-amber-500/80"];

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
    <dd className="min-w-0 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{children}</dd>
  </div>
);

export function ComparisonView({ portfolioId, c }: { portfolioId: string; c: Comparison }) {
  const cols = c.columns;
  return (
    <div className="space-y-5">
      <p className={`rounded border px-3 py-2 text-xs ${c.commonBasis ? "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/40 dark:text-zinc-300" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-900/10 dark:text-amber-200"}`}>
        <strong className="font-semibold">{c.commonBasis ? "Compared using the same current reference inputs." : "Caution."}</strong>{" "}
        {c.commonBasis ? `Valuation date ${formatIsoDate(c.valuationDate!)} · starting portfolio value ${c.startingValueGhs === null ? "—" : `GHS ${c.startingValueGhs.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`} in every view. Each scenario was calculated independently in this request, so differences come only from the assumptions.` : c.basisNote}
      </p>

      {c.summary.length > 0 && (
        <section aria-labelledby="which" className={CARD}>
          <h2 id="which" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Which view has the larger effect, and why
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-zinc-700 dark:text-zinc-300">
            {c.summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="side" className={`grid gap-3 ${cols.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        <h2 id="side" className="sr-only">
          Scenarios side by side
        </h2>
        {cols.map((col, i) => (
          <article key={col.id} className={CARD} aria-label={col.name}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${SERIES[i]}`} aria-hidden="true" />
              <Link href={`/portfolios/${portfolioId}/scenarios/${col.id}`} className="hover:underline">
                {col.name}
              </Link>
            </h3>
            <dl className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
              <Row label="Value under this scenario">{col.scenarioValueText}</Row>
              <Row label="Change">
                <span className={`font-semibold ${impactTone(col.impactGhs)}`}>{col.impactText}</span>
              </Row>
              <Row label="Change %">
                <span className={impactTone(col.impactGhs)}>{col.impactPctText}</span>
              </Row>
              <Row label="Main driver">{col.mainClassDriver ?? "—"}</Row>
              <Row label="Largest holding impact">{col.largestPosition ? `${col.largestPosition} (${col.largestPositionImpactText})` : "—"}</Row>
              <Row label="Stale-input basis">{col.staleBasisPct === null ? "—" : `${col.staleBasisPct.toFixed(1)}% of starting value`}</Row>
              <Row label="Excluded holdings">{col.excludedCount}</Row>
              {col.repricingErrors > 0 && <Row label="Could not be repriced">{col.repricingErrors}</Row>}
            </dl>
          </article>
        ))}
      </section>

      <section aria-labelledby="assump" className={CARD}>
        <h2 id="assump" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Assumptions side by side
        </h2>
        <p className="mb-2 text-[11px] text-zinc-500 dark:text-zinc-400">Each row is one assumption, matched across scenarios by what it applies to. A dash means that scenario has {NO_ASSUMPTION_TEXT.toLowerCase().replace(/\.$/, "")}; 0 means an explicit assumption of no change.</p>
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th scope="col" className="w-[34%] py-1.5 pr-2 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Applies to
              </th>
              {cols.map((col, i) => (
                <th key={col.id} scope="col" className="px-1 py-1.5 text-right align-bottom text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
                  <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${SERIES[i]}`} aria-hidden="true" />
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {c.assumptionRows.map((r) => (
              <tr key={r.key}>
                <th scope="row" className="py-1.5 pr-2 text-left align-top font-normal text-zinc-900 dark:text-zinc-100">
                  {r.label}
                  {r.level !== "ASSET_CLASS" && <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{r.levelLabel}</span>}
                </th>
                {r.cells.map((cell, i) => (
                  <td key={cols[i].id} className="px-1 py-1.5 text-right align-top tabular-nums">
                    {cell === null ? (
                      <span className="text-zinc-400 dark:text-zinc-500" title={NO_ASSUMPTION_TEXT}>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">{NO_ASSUMPTION_TEXT}</span>
                      </span>
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {c.assumptionRows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="py-2 text-xs text-zinc-500 dark:text-zinc-400">
                  None of these scenarios has assumptions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="bars" className={CARD}>
        <h2 id="bars" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Where each view&rsquo;s effect comes from
        </h2>
        <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">Impact by asset class under each view, on the same scale.</p>
        <div className="space-y-4">
          {EXPOSURE_ASSET_CLASS_ORDER.map((k) => (
            <div key={k}>
              <p className="mb-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{EXPOSURE_ASSET_CLASS_LABEL[k]}</p>
              <ul className="space-y-1.5">
                {cols.map((col, i) => {
                  const cell = col.classImpacts.find((x) => x.assetClass === k)!;
                  return (
                    <li key={col.id} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-2 text-xs sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
                      <span className="flex items-center gap-1.5 truncate text-zinc-600 dark:text-zinc-400">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-sm ${SERIES[i]}`} aria-hidden="true" />
                        <span className="truncate">{col.name}</span>
                      </span>
                      <DivergingBar value={cell.impactGhs} max={c.maxAbsClassImpact} />
                      <span className={`whitespace-nowrap text-right tabular-nums ${impactTone(cell.impactGhs)}`}>{signedGhsWhole(cell.impactGhs)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
