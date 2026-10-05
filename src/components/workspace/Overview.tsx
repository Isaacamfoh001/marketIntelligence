// ---------------------------------------------------------------------------
// Overview perspective (M9.0): "What does this portfolio look like?" Reading
// order — what matters → at a glance (four charts, each one question) → what
// could move it → what to look at first. No chart exists without a question.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { HoldingView, MaturityProfile } from "@/lib/decision-insights";
import { EXPOSURE_ASSET_CLASS_LABEL, type PortfolioExposures } from "@/lib/portfolio";
import { formatGhs } from "@/lib/fixed-income";
import { ghsCompact, ghsWhole } from "@/lib/scenario-studio/format";
import type { TemplatePreview } from "@/lib/queries/workspace";
import type { DecisionInsights } from "@/lib/decision-insights";
import { Donut, MaturityColumns, RankedBars } from "./charts";
import { InvestigationList, KeyInsights, PrimaryConclusionCard } from "./Insights";
import { Card, CLASS_VAR, FOCUS, SectionHeading } from "./shared";

const pct = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

export function Overview({ portfolioId, archived, exposures, holdings, maturity, insights, previews }: { portfolioId: string; archived: boolean; exposures: PortfolioExposures; holdings: HoldingView[]; maturity: MaturityProfile; insights: DecisionInsights; previews: TemplatePreview[] }) {
  const rows = exposures.allocation.rows;
  const issuers = exposures.issuers.rows.slice(0, 5);
  const rateRows = holdings
    .filter((h) => h.rate)
    .sort((a, b) => b.rate!.per1ppGhs - a.rate!.per1ppGhs || a.label.localeCompare(b.label))
    .slice(0, 5);
  const hasMaturity = maturity.totalNominalGhs > 0;
  const top = holdings.filter((h) => h.status === "VALUED").slice(0, 5);
  const link = (view: string) => `/portfolios/${portfolioId}?view=${view}`;

  return (
    <div className="space-y-10">
      {/* 1 — WHAT MATTERS */}
      {insights.primary && (
        <section aria-labelledby="matters">
          <SectionHeading id="matters" hint="Ranked by how much of the portfolio each point touches — facts first, then what they mean.">What matters</SectionHeading>
          <div className="space-y-3">
            <PrimaryConclusionCard conclusion={insights.primary} heading="Main takeaway" />
            <KeyInsights insights={insights.insights.filter((i) => !insights.primary!.basedOn.includes(i.id))} investigations={insights.investigations} />
          </div>
        </section>
      )}

      {/* 2 — AT A GLANCE */}
      <section aria-labelledby="glance">
        <SectionHeading id="glance" hint="Four questions, four views. Exact figures sit beside every chart.">Portfolio at a glance</SectionHeading>
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.length > 0 && (
            <Card title="Asset mix" question="What is this portfolio made of?">
              <Donut
                centerLabel="Valued"
                centerValue={exposures.allocation.denominatorGhs ? ghsCompact(exposures.allocation.denominatorGhs) : "—"}
                slices={rows.map((r) => ({ key: r.assetClass, label: EXPOSURE_ASSET_CLASS_LABEL[r.assetClass], pct: r.pct, valueText: ghsCompact(r.referenceValueGhs), color: CLASS_VAR[r.assetClass] }))}
              />
            </Card>
          )}
          {issuers.length > 0 && (
            <Card title="Biggest issuers" question="Whose credit does the portfolio ultimately depend on?">
              <RankedBars
                ariaLabel="Issuer exposure, largest first"
                rows={issuers.map((r) => ({ key: r.issuer.key, label: r.issuer.name, sub: r.assetClasses.map((c) => EXPOSURE_ASSET_CLASS_LABEL[c].toLowerCase()).join(" + "), magnitude: r.pct, valueText: pct(r.pct), detailText: ghsWhole(r.referenceValueGhs), color: "var(--c-gov)" }))}
              />
              <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">A company&rsquo;s bond and shares count as one issuer. <Link href={link("exposure")} className={`rounded text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>All exposures →</Link></p>
            </Card>
          )}
          {hasMaturity && (
            <Card title="Maturity profile" question="When does capital come due?">
              <MaturityColumns profile={maturity} formatGhs={(n) => ghsCompact(n).replace("GHS ", "")} />
              <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">Principal in GHS (bond nominal and Treasury-bill face value) by remaining life — contractual terms, not market value.</p>
            </Card>
          )}
          {rateRows.length > 0 && (
            <Card title="Rate sensitivity" question="Where does a change in interest rates hit hardest?">
              <RankedBars
                ariaLabel="Estimated value change for a 1 percentage-point rate rise, largest first"
                rows={rateRows.map((h) => ({ key: h.positionId, label: h.label, sub: h.assetClassLabel, magnitude: h.rate!.per1ppGhs, valueText: `−${ghsCompact(h.rate!.per1ppGhs)}`, detailText: `${pct(h.weightPct ?? 0)} of portfolio value`, color: CLASS_VAR[h.assetClass], href: h.inspectHref }))}
              />
              <p className="mt-4 text-[11px] text-zinc-500 dark:text-zinc-400">Estimated change in each holding&rsquo;s value if its own rate rose by 1 percentage point — a first-order estimate, not a forecast.</p>
            </Card>
          )}
        </div>
      </section>

      {/* 3 — WHAT COULD MOVE IT */}
      {previews.length > 0 && (
        <section aria-labelledby="stress">
          <SectionHeading id="stress" hint="Hypothetical assumptions applied to today's Reference Values. A scenario is not a forecast — open one to see exactly what it assumes.">What could move it</SectionHeading>
          <ul className="grid gap-3 md:grid-cols-3">
            {previews.map((p) => (
              <li key={p.id}>
                <Link href={`/portfolios/${portfolioId}?view=scenarios&stress=${p.id}`} className={`block h-full rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600 ${FOCUS}`}>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{p.name}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{p.assumptionSummary}</span>
                  <span className="mt-3 block text-xl font-semibold tabular-nums" style={{ color: p.impactGhs === null || p.impactGhs === 0 ? undefined : p.impactGhs < 0 ? "var(--c-loss)" : "var(--c-gain)" }}>
                    {p.impactText ?? "—"} <span className="text-sm font-medium">{p.impactPctText ? `(${p.impactPctText})` : ""}</span>
                  </span>
                  <span className="mt-2 block text-xs font-medium text-blue-700 dark:text-blue-400">See assumptions and drivers <span aria-hidden>→</span></span>
                </Link>
              </li>
            ))}
          </ul>
          {!archived && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Want different assumptions? <Link href={`/portfolios/${portfolioId}/scenarios`} className={`rounded text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>Build a custom scenario</Link>.</p>}
        </section>
      )}

      {/* 4 — WHAT DESERVES ATTENTION */}
      <section aria-labelledby="attention">
        <SectionHeading id="attention" hint="Investigation prompts with the measured reason — not recommendations.">Worth investigating</SectionHeading>
        <InvestigationList items={insights.investigations} />
      </section>

      {/* 5 — LARGEST HOLDINGS */}
      {top.length > 0 && (
        <section aria-labelledby="largest">
          <SectionHeading id="largest">Largest holdings</SectionHeading>
          <RankedBars
            ariaLabel="Largest holdings by Reference Value"
            rows={top.map((h) => ({ key: h.positionId, label: h.label, sub: h.assetClassLabel, magnitude: h.referenceValueGhs ?? 0, valueText: formatGhs(h.referenceValueGhs!), detailText: `${pct(h.weightPct ?? 0)} of valued Reference Value`, color: CLASS_VAR[h.assetClass], href: h.inspectHref }))}
          />
          <p className="mt-3 text-sm"><Link href={link("holdings")} className={`rounded font-medium text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>See all {holdings.length} holdings →</Link></p>
        </section>
      )}
    </div>
  );
}
