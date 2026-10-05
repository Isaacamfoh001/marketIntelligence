// ---------------------------------------------------------------------------
// Scenario perspective (M9.0): "What happens under my assumptions?" Templates
// are hypothetical starting points. Choosing one SHOWS its assumptions and the
// effect in memory — nothing is saved until the analyst chooses to save it.
// A scenario is not a forecast.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { ScenarioInsight } from "@/lib/decision-insights";
import { formatGhs } from "@/lib/fixed-income";
import { HYPOTHETICAL_NOTICE, ESTIMATE_NOTICE, SCENARIO_TEMPLATES, TEMPLATE_DISCLAIMER } from "@/lib/scenario-studio";
import type { LibraryRow } from "@/lib/queries/scenarios";
import { createFromTemplateAction } from "@/app/portfolios/[portfolioId]/scenarios/actions";
import { ContributionChart } from "./charts";
import { InvestigationList } from "./Insights";
import { Disclosure, EYEBROW, FOCUS, PANEL, SectionHeading } from "./shared";

const toneOf = (n: number | null) => (n === null || n === 0 ? undefined : n < 0 ? "var(--c-loss)" : "var(--c-gain)");

export function StressPicker({ portfolioId, activeTemplate, activeScenario, library, archived }: { portfolioId: string; activeTemplate?: string; activeScenario?: string; library: LibraryRow[]; archived: boolean }) {
  const href = (q: string) => `/portfolios/${portfolioId}?view=scenarios&${q}`;
  return (
    <div className="space-y-4">
      <div>
        <p className={EYEBROW}>Stress this portfolio</p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{TEMPLATE_DISCLAIMER} The assumptions are shown with every result.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIO_TEMPLATES.map((t) => (
            <Link key={t.id} href={href(`stress=${t.id}`)} scroll={false} aria-current={activeTemplate === t.id ? "true" : undefined} className={`rounded-xl border p-3 transition-colors ${FOCUS} ${activeTemplate === t.id ? "border-blue-600 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30" : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"}`}>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</span>
              <span className="mt-1 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">{t.blurb}</span>
            </Link>
          ))}
          {!archived && (
            <Link href={`/portfolios/${portfolioId}/scenarios`} className={`rounded-xl border border-dashed border-zinc-300 p-3 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500 ${FOCUS}`}>
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Custom</span>
              <span className="mt-1 block text-xs leading-snug text-zinc-500 dark:text-zinc-400">Set your own assumptions for a bill, bond, issuer or equity in Scenario Studio.</span>
            </Link>
          )}
        </div>
      </div>
      {library.length > 0 && (
        <div>
          <p className={EYEBROW}>Your saved scenarios</p>
          <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {library.map((s) => (
              <li key={s.id}>
                <Link href={href(`scenario=${s.id}`)} scroll={false} aria-current={activeScenario === s.id ? "true" : undefined} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${FOCUS} ${activeScenario === s.id ? "bg-blue-50/60 dark:bg-blue-900/10" : ""}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{s.name}</span>
                    <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400">{s.assumptionSummary}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: toneOf(s.impactGhs) }}>
                    {s.invalid ? "Cannot be run" : s.impactText ? `${s.impactText} (${s.impactPctText})` : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ScenarioOutcome({ insight, portfolioId, templateId, scenarioId, archived }: { insight: ScenarioInsight; portfolioId: string; templateId?: string; scenarioId?: string; archived: boolean }) {
  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
        <strong className="font-semibold">{HYPOTHETICAL_NOTICE}</strong> {ESTIMATE_NOTICE}
      </p>

      <section aria-label="What is being tested" className={PANEL}>
        <p className={EYEBROW}>What is being tested</p>
        <ul className="mt-2 space-y-1.5">
          {insight.assumptions.map((a) => (
            <li key={a.technical + a.plain} className="flex flex-wrap items-baseline gap-x-2 text-sm text-zinc-900 dark:text-zinc-100">
              <span>{a.plain}</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{a.technical}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Scenario result" className="rounded-xl border-l-4 border-l-blue-600 bg-blue-50/60 p-5 dark:border-l-blue-400 dark:bg-blue-950/30">
        <p className={EYEBROW}>Result</p>
        <p className="mt-2 text-lg font-semibold leading-snug tracking-tight text-zinc-950 dark:text-white sm:text-xl">{insight.fact}</p>
        {insight.interpretation && <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">{insight.interpretation}</p>}
        {insight.status !== "NOT_AVAILABLE" && insight.startingGhs !== null && (
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{insight.basis.analytical ? insight.basis.label : `Starting ${insight.basis.label}`}</dt>
              <dd className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{insight.startingGhs.toLocaleString("en-GB", { style: "currency", currency: "GHS", maximumFractionDigits: 0 })}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">Under this scenario</dt>
              <dd className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{insight.scenarioGhs?.toLocaleString("en-GB", { style: "currency", currency: "GHS", maximumFractionDigits: 0 })}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">Change</dt>
              <dd className="text-xl font-semibold tabular-nums" style={{ color: toneOf(insight.impactGhs) }}>
                {insight.impactText} <span className="text-sm">({insight.impactPctText})</span>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {insight.status === "RESULT" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section aria-label="Contribution by asset class" className={PANEL}>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">By asset class</h3>
            <p className="mb-4 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Which part of the portfolio produced the change?</p>
            <ContributionChart rows={insight.byClass} ariaLabel="Scenario impact by asset class" />
          </section>
          <section aria-label="Contribution by holding" className={PANEL}>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">By holding</h3>
            <p className="mb-4 mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Which individual holdings moved the result most?</p>
            <ContributionChart rows={insight.byHolding} other={insight.otherHoldings} ariaLabel="Scenario impact by holding" />
            <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">{insight.reconciles ? "Holding impacts add up exactly to the portfolio total." : "Holding impacts could not be reconciled to the portfolio total — see Scenario Studio."}</p>
          </section>
        </div>
      )}

      {insight.status !== "NOT_AVAILABLE" && insight.basis.line && (
        <section aria-label="Valuation basis of the starting value" className={`${PANEL} ${insight.basis.analytical ? "border-indigo-200 dark:border-indigo-400/30" : ""}`}>
          <p className={EYEBROW}>Valuation basis of the starting value</p>
          <p className="mt-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100"><span aria-hidden>{insight.basis.analytical ? "◇ " : "● "}</span>{insight.basis.line}</p>
          {insight.basis.analytical ? (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              The scenario shock is applied on top of this starting point, so the result depends on both. {insight.basis.assumptionGhs !== null ? `${formatGhs(insight.basis.assumptionGhs)} of the starting value is an analyst assumption, not an observed price.` : ""} Change a starting assumption in Holdings and this result changes.
            </p>
          ) : (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">Every participating holding starts from a Korbly-supported valuation.</p>
          )}
          {insight.basis.excludedCount > 0 && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{insight.basis.excludedCount} {insight.basis.excludedCount === 1 ? "holding is" : "holdings are"} excluded — no Korbly valuation and no assumption.</p>}
        </section>
      )}

      <section aria-label="Data quality of this result" className={`${PANEL} ${insight.quality.caution ? "border-amber-200 dark:border-amber-900/60" : ""}`}>
        <p className={EYEBROW}>How much to trust it</p>
        <p className="mt-1.5 text-sm text-zinc-800 dark:text-zinc-200">{insight.quality.statement}</p>
        {insight.quality.excluded > 0 && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Korbly would rather exclude a holding than make up a number.</p>}
      </section>

      {insight.investigations.length > 0 && (
        <div>
          <SectionHeading id="scenario-investigate" hint="Prompts drawn from this result — not recommendations.">Worth investigating</SectionHeading>
          <InvestigationList items={insight.investigations} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        {scenarioId ? (
          <Link href={`/portfolios/${portfolioId}/scenarios/${scenarioId}`} className={`rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${FOCUS}`}>
            Open in Scenario Studio
          </Link>
        ) : templateId && !archived ? (
          <form action={createFromTemplateAction.bind(null, portfolioId, templateId)}>
            <button type="submit" className={`rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${FOCUS}`}>
              Save and edit in Scenario Studio
            </button>
          </form>
        ) : null}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{scenarioId ? "Recalculated now from current reference inputs." : "Not saved — calculated now from current reference inputs."}</p>
      </div>

      <Disclosure summary="Technical detail and exact figures">
        <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-xs dark:divide-zinc-800 dark:border-zinc-800">
          {insight.evidence.map((e, i) => (
            <div key={`${e.label}-${i}`} className="grid gap-x-4 px-3 py-1.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <dt className="text-zinc-500 dark:text-zinc-400">{e.label}</dt>
              <dd className="tabular-nums text-zinc-900 dark:text-zinc-100">{e.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Every holding&rsquo;s starting value, yield or price, scenario calculation and source is in{" "}
          <Link href={scenarioId ? `/portfolios/${portfolioId}/scenarios/${scenarioId}` : `/portfolios/${portfolioId}/scenarios`} className={`rounded text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>
            Scenario Studio
          </Link>
          .
        </p>
      </Disclosure>
    </div>
  );
}
