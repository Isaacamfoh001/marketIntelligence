// ---------------------------------------------------------------------------
// Scenario result presentation (M8.3). Labelling and layout only — every
// number arrives already calculated by src/lib/scenarios/engine.ts. A minimal
// validation surface; M8.4 owns the polished Scenario Studio.
//
// Wording is conditional by design: "scenario value", "scenario impact", "if
// these assumptions held". Never predicted/expected/forecast.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { ParticipatingPositionResult, ScenarioPortfolioResult, ScenarioPositionResult, UnavailablePositionResult } from "@/lib/scenarios";
import { EXPOSURE_ASSET_CLASS_LABEL } from "@/lib/portfolio";
import { formatGhs, formatIsoDate } from "@/lib/fixed-income";
import { RecencyBadge } from "@/components/portfolio/ui";

const TH = "px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
const TD = "px-2 py-2 align-top";
const NUM = "whitespace-nowrap px-2 py-2 text-right align-top tabular-nums";

const signed = (n: number, dp = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const signedGhs = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatGhs(Math.abs(n))}`;
const signedPct = (n: number | null) => (n === null ? "—" : `${signed(n)}%`);
const tone = (n: number) => (n < 0 ? "text-red-700 dark:text-red-400" : n > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600 dark:text-zinc-300");
const price = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function Stat({ label, value, sub, valueClass = "" }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 ${valueClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</p>}
    </div>
  );
}

export function ScenarioSummary({ p }: { p: ScenarioPortfolioResult }) {
  if (p.referenceBasisGhs === null || p.scenarioValueGhs === null || p.impactGhs === null) {
    return (
      <section aria-label="Scenario result" className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        No position in this portfolio has a reference value to start from, so there is no scenario result. Unvalued positions are never given a scenario value.
      </section>
    );
  }
  return (
    <section aria-label="Scenario result" className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">
        Valued positions only · valuation date {formatIsoDate(p.valuationDate)} · what the assumptions above would do if they held — not a forecast.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Reference value" value={formatGhs(p.referenceBasisGhs)} sub={`${p.participatingCount} valued position${p.participatingCount === 1 ? "" : "s"}`} />
        <Stat label="Scenario value" value={formatGhs(p.scenarioValueGhs)} sub="of the valued positions" />
        <Stat label="Scenario impact" value={signedGhs(p.impactGhs)} valueClass={tone(p.impactGhs)} />
        <Stat label="Impact %" value={signedPct(p.impactPct)} valueClass={tone(p.impactGhs)} sub="of the reference value" />
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-600 sm:grid-cols-2 lg:grid-cols-4 dark:border-zinc-800 dark:text-zinc-300">
        <div>
          <dt className="inline text-zinc-500 dark:text-zinc-400">Positions: </dt>
          <dd className="inline tabular-nums">{p.positionCount}</dd>
        </div>
        <div>
          <dt className="inline text-zinc-500 dark:text-zinc-400">Valued / in scenario: </dt>
          <dd className="inline tabular-nums">
            {p.valuedCount} / {p.participatingCount}
          </dd>
        </div>
        <div>
          <dt className="inline text-zinc-500 dark:text-zinc-400">Shocked / unchanged: </dt>
          <dd className="inline tabular-nums">
            {p.shockedPositionCount} / {p.unchangedPositionCount}
          </dd>
        </div>
        <div>
          <dt className="inline text-zinc-500 dark:text-zinc-400">Unvalued (excluded): </dt>
          <dd className="inline tabular-nums">{p.unvaluedCount}</dd>
        </div>
        {p.scenarioErrorCount > 0 && (
          <div>
            <dt className="inline text-zinc-500 dark:text-zinc-400">Could not be repriced: </dt>
            <dd className="inline tabular-nums text-amber-700 dark:text-amber-400">{p.scenarioErrorCount}</dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="inline text-zinc-500 dark:text-zinc-400">Stale-input basis: </dt>
          <dd className="inline tabular-nums">
            {p.staleBasis.count} position{p.staleBasis.count === 1 ? "" : "s"} · reference {formatGhs(p.staleBasis.referenceValueGhs)}
            {p.staleBasisPct !== null && ` (${p.staleBasisPct.toFixed(1)}% of basis)`} · impact {signedGhs(p.staleBasis.impactGhs)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function ClassImpactTable({ p }: { p: ScenarioPortfolioResult }) {
  const rows = p.byAssetClass.filter((r) => r.participatingCount > 0);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="by-class" className="min-w-0">
      <h2 id="by-class" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Impact by asset class
      </h2>
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <tr>
              <th className={`${TH} text-left`}>Asset class</th>
              <th className={`${TH} text-right`}>Reference value</th>
              <th className={`${TH} text-right`}>Scenario value</th>
              <th className={`${TH} text-right`}>Impact (GHS)</th>
              <th className={`${TH} text-right`} title="Class impact ÷ the class's own reference value">
                Class impact %
              </th>
              <th className={`${TH} text-right`} title="Class impact ÷ the whole portfolio's reference value">
                Share of portfolio basis
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.assetClass}>
                <td className={TD}>
                  {EXPOSURE_ASSET_CLASS_LABEL[r.assetClass]} <span className="text-[11px] text-zinc-400">({r.participatingCount})</span>
                </td>
                <td className={NUM}>{formatGhs(r.referenceValueGhs)}</td>
                <td className={NUM}>{formatGhs(r.scenarioValueGhs)}</td>
                <td className={`${NUM} font-medium ${tone(r.impactGhs)}`}>{signedGhs(r.impactGhs)}</td>
                <td className={`${NUM} ${tone(r.impactGhs)}`}>{signedPct(r.impactPct)}</td>
                <td className={`${NUM} ${tone(r.impactGhs)}`}>{signedPct(r.contributionPct)}</td>
              </tr>
            ))}
            <tr className="bg-zinc-50 font-medium dark:bg-zinc-900/60">
              <td className={TD}>Total</td>
              <td className={NUM}>{formatGhs(p.referenceBasisGhs ?? 0)}</td>
              <td className={NUM}>{formatGhs(p.scenarioValueGhs ?? 0)}</td>
              <td className={`${NUM} ${tone(p.impactGhs ?? 0)}`}>{signedGhs(p.impactGhs ?? 0)}</td>
              <td className={`${NUM} ${tone(p.impactGhs ?? 0)}`}>{signedPct(p.impactPct)}</td>
              <td className={`${NUM} ${tone(p.impactGhs ?? 0)}`}>{signedPct(p.impactPct)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Class impacts add up exactly to the total impact. {p.reconciles ? "" : "RECONCILIATION FAILURE — do not rely on these figures."}</p>
    </section>
  );
}

function appliedRuleText(r: ScenarioPositionResult): string {
  const w = r.resolution.winner;
  if (!w) return "No assumption applies — unchanged";
  const v = `${w.value > 0 ? "+" : ""}${w.value}${w.shockType === "YIELD_BPS" ? " bps" : "%"}`;
  const level = w.selector.kind === "SECURITY" ? "Security" : w.selector.kind === "ISSUER" ? "Issuer" : "Asset class";
  return `${level}: ${w.targetLabel} ${v}`;
}

function PositionRows({ r }: { r: ParticipatingPositionResult }) {
  const d = r.detail;
  return (
    <tr className="align-top">
      <td className={TD}>
        <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.label}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          {EXPOSURE_ASSET_CLASS_LABEL[r.assetClass]} <RecencyBadge recency={r.recency} />
        </div>
      </td>
      <td className={`${TD} text-xs`}>
        <div>{appliedRuleText(r)}</div>
        <details className="mt-0.5 text-zinc-500 dark:text-zinc-400">
          <summary className="cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Why this rule</summary>
          <p className="mt-1 max-w-xs">{r.resolution.reason}</p>
          {r.resolution.matchedRules.length > 1 && (
            <ul className="mt-1 list-disc pl-4">
              {r.resolution.matchedRules.map((m) => (
                <li key={m.id} className={m.id === r.resolution.winner?.id ? "font-medium text-zinc-700 dark:text-zinc-200" : ""}>
                  {m.targetLabel} {m.value > 0 ? "+" : ""}
                  {m.value}
                  {m.shockType === "YIELD_BPS" ? " bps" : "%"} {m.id === r.resolution.winner?.id ? "(applied)" : "(overridden)"}
                </li>
              ))}
            </ul>
          )}
        </details>
      </td>
      <td className={`${TD} text-xs`}>
        {d.assetClass === "BOND" ? (
          <div className="space-y-0.5 tabular-nums">
            <div>
              Yield {d.referenceYieldPct.toFixed(4)}% → {d.scenarioYieldPct.toFixed(4)}% ({d.appliedShockBps > 0 ? "+" : ""}
              {d.appliedShockBps} bps)
            </div>
            <div>
              Dirty price {price(d.referenceDirtyPrice)} → {price(d.scenarioDirtyPrice)}
            </div>
            {d.firstOrderImpactGhs !== null && (
              <div className="text-zinc-500 dark:text-zinc-400" title="−DV01 × shock. A first-order estimate shown for comparison; the repriced impact is the result.">
                First-order DV01 estimate {signedGhs(d.firstOrderImpactGhs)} (repricing is authoritative)
              </div>
            )}
          </div>
        ) : (
          <div className="tabular-nums">
            Price GHS {price(d.referencePriceGhs)} → {price(d.scenarioPriceGhs)} ({d.appliedShockPct > 0 ? "+" : ""}
            {d.appliedShockPct}%)
          </div>
        )}
        {r.warnings.map((w) => (
          <p key={w} className="mt-0.5 text-amber-700 dark:text-amber-400">
            {w}
          </p>
        ))}
      </td>
      <td className={NUM}>{formatGhs(r.referenceValueGhs)}</td>
      <td className={NUM}>{formatGhs(r.scenarioValueGhs)}</td>
      <td className={`${NUM} font-medium ${tone(r.impactGhs)}`}>{signedGhs(r.impactGhs)}</td>
      <td className={`${NUM} ${tone(r.impactGhs)}`}>{signedPct(r.impactPct)}</td>
    </tr>
  );
}

export function PositionResults({ positions }: { positions: ScenarioPositionResult[] }) {
  const part = positions.filter((p): p is ParticipatingPositionResult => p.status === "PARTICIPATING");
  if (part.length === 0) return null;
  return (
    <section aria-labelledby="by-position">
      <h2 id="by-position" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Impact by position
      </h2>
      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[60rem] border-collapse text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <tr>
              <th className={`${TH} text-left`}>Position</th>
              <th className={`${TH} text-left`}>Applied assumption</th>
              <th className={`${TH} text-left`}>Reference → scenario</th>
              <th className={`${TH} text-right`}>Reference value</th>
              <th className={`${TH} text-right`}>Scenario value</th>
              <th className={`${TH} text-right`}>Impact (GHS)</th>
              <th className={`${TH} text-right`} title="Position impact ÷ this position's reference value">
                Position impact %
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {part.map((r) => (
              <PositionRows key={r.positionId} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Contributors({ p }: { p: ScenarioPortfolioResult }) {
  if (p.largestNegative.length === 0 && p.largestPositive.length === 0) return null;
  const list = (title: string, rows: ParticipatingPositionResult[]) =>
    rows.length === 0 ? null : (
      <div className="min-w-0 rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{title}</h3>
        <ol className="mt-2 space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.positionId} className="flex items-baseline justify-between gap-3">
              <span className="truncate">{r.label}</span>
              <span className={`whitespace-nowrap tabular-nums ${tone(r.impactGhs)}`} title="Contribution = position impact ÷ portfolio reference value">
                {signedGhs(r.impactGhs)} <span className="text-[11px] text-zinc-400">({signedPct(r.contributionPct)} of basis)</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  return (
    <section aria-label="Largest scenario impacts" className="grid gap-3 md:grid-cols-2">
      {list("Largest negative contributors", p.largestNegative)}
      {list("Largest positive contributors", p.largestPositive)}
    </section>
  );
}

export function UnavailableSection({ portfolioId, positions }: { portfolioId: string; positions: ScenarioPositionResult[] }) {
  const rows = positions.filter((p): p is UnavailablePositionResult => p.status === "UNAVAILABLE");
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="excluded" className="rounded border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/50 dark:bg-amber-900/10">
      <h2 id="excluded" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Excluded from the scenario ({rows.length})
      </h2>
      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">With no reference value there is nothing defensible to apply an assumption to. These are excluded — never counted as zero.</p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {rows.map((r) => (
          <li key={r.positionId}>
            <Link href={`/portfolios/${portfolioId}?position=${r.positionId}#inspect`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
              {r.label}
            </Link>
            <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-400">
              {r.code === "UNVALUED_REFERENCE" ? "No reference value: " : "Could not be repriced under these assumptions: "}
              {r.reason}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Explanations({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <section aria-label="What the assumptions do" className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">What these assumptions do</h2>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-zinc-700 dark:text-zinc-300">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </section>
  );
}

export function ScenarioMethodology() {
  return (
    <details className="rounded border border-zinc-200 bg-white p-4 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <summary className="cursor-pointer select-none text-sm font-medium text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-200">How scenarios are calculated</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>A scenario is an assumption you choose — not a forecast. Korbly applies it to the reference values already shown on the portfolio page and reports the arithmetic consequence. It says nothing about whether the assumption is likely.</p>
        <p>
          <strong>Bonds:</strong> scenario yield = reference yield + shock (bps ÷ 100, in percent). Every remaining cash flow is then repriced at that yield with the same Fixed Income pricing engine, on the same valuation date, as a dirty price (accrued interest is unchanged by a yield shock). DV01 × shock is shown only as a first-order comparison.
        </p>
        <p>
          <strong>Equities:</strong> scenario price = reference price × (1 + shock %). A price cannot fall below zero, so shocks below −100% are rejected.
        </p>
        <p>
          <strong>Which assumption applies:</strong> security beats issuer beats asset class. Exactly one applies to a position; they never add up. A position no assumption reaches is unchanged. Positions with no reference value are excluded — no baseline, no scenario.
        </p>
        <p>
          <strong>Percentages:</strong> position/class impact % divides by that position&rsquo;s (or class&rsquo;s) own reference value; &ldquo;share of portfolio basis&rdquo; divides by the whole valued reference value. Stale inputs stay stale — an assumption does not make them current.
        </p>
      </div>
    </details>
  );
}
