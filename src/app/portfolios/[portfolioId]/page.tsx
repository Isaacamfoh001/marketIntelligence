import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio, getPortfolioExposures, getPositionProvenance } from "@/lib/queries/portfolio";
import { formatIsoDate } from "@/lib/fixed-income";
import { archivePortfolioAction, restorePortfolioAction } from "../actions";
import { CoverageSummary } from "@/components/portfolio/CoverageSummary";
import { AssetAllocationPanel, Callouts, CouponPanel, IssuerPanel, MaturityLadderPanel, RateSensitivityPanel, UpcomingMaturitiesPanel } from "@/components/portfolio/ExposurePanels";
import { EXPOSURE_COPY } from "@/lib/portfolio";
import { GroupHeading } from "@/components/portfolio/exposure-ui";
import { MethodologyDisclosure } from "@/components/portfolio/MethodologyDisclosure";
import { PositionDrilldown } from "@/components/portfolio/PositionDrilldown";
import { PositionsTable, UnvaluedSection } from "@/components/portfolio/PositionsTable";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Portfolio detail (M8.1). Reading order: what is it worth and how well can we
// say so → the positions → what could not be valued and why → how it works.
// ---------------------------------------------------------------------------

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ portfolioId: string }>; searchParams: Promise<{ position?: string; duplicate?: string; saved?: string; removed?: string }> }) {
  const { portfolioId } = await params;
  const query = await searchParams;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();

  const selected = query.position ? portfolio.positions.find((p) => p.positionId === query.position) : undefined;
  const provenance = selected ? await getPositionProvenance(selected) : null;
  const archived = portfolio.archivedAt !== null;
  const exposures = getPortfolioExposures(portfolio);
  const hasBonds = portfolio.positions.some((p) => p.holding.assetClass === "BOND");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
            <Link href="/portfolios" className="hover:underline">
              Portfolios
            </Link>
          </nav>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {portfolio.name}
            {archived && <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">Archived</span>}
          </h1>
          {portfolio.description && <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">{portfolio.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {archived ? (
            <form action={restorePortfolioAction.bind(null, portfolio.id)}>
              <button type="submit" className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Restore portfolio
              </button>
            </form>
          ) : (
            <>
              <Link href={`/portfolios/${portfolio.id}/add`} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
                Add position
              </Link>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Archive…</summary>
                <form action={archivePortfolioAction.bind(null, portfolio.id)} className="absolute right-0 z-10 mt-1 w-64 rounded border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">Archiving hides this portfolio from the active list. Its positions are kept and it can be restored.</p>
                  <button type="submit" className="mt-2 rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800">
                    Confirm archive
                  </button>
                </form>
              </details>
            </>
          )}
        </div>
      </header>

      {archived && <p className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">This portfolio is archived and read-only. Restore it to change positions.</p>}
      {query.removed && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Position removed.</p>}

      <CoverageSummary summary={portfolio.summary} />

      {portfolio.positions.length > 0 && (
        <>
          <Callouts callouts={exposures.callouts} />

          <section aria-label="Exposure" className="space-y-3">
            <GroupHeading note="Market analytics — built from reference values">Exposure</GroupHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <AssetAllocationPanel e={exposures} />
              <IssuerPanel e={exposures} />
            </div>
          </section>

          {hasBonds && (
            <>
              <section aria-label="Fixed-income profile" className="space-y-3">
                <GroupHeading note="Rate sensitivity is market-based; the ladder is contractual">Fixed-income profile</GroupHeading>
                <RateSensitivityPanel e={exposures} portfolioId={portfolio.id} />
                <MaturityLadderPanel e={exposures} portfolioId={portfolio.id} />
              </section>

              <section aria-label="Contractual cash flows" className="space-y-3">
                <GroupHeading note="Contractual — from bond terms, not market data">Contractual cash flows</GroupHeading>
                <div className="grid gap-3 lg:grid-cols-2">
                  <CouponPanel e={exposures} portfolioId={portfolio.id} />
                  <UpcomingMaturitiesPanel e={exposures} portfolioId={portfolio.id} />
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{EXPOSURE_COPY.contractualVsMarket}</p>
              </section>
            </>
          )}
        </>
      )}

      {selected && <PositionDrilldown portfolioId={portfolio.id} row={selected} provenance={provenance} valuationDateIso={portfolio.valuationDate} notice={query.duplicate ? "duplicate" : query.saved ? "saved" : undefined} />}

      <section aria-labelledby="positions">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h2 id="positions" className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Positions
          </h2>
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">Valued {formatIsoDate(portfolio.valuationDate)} · select a position to see its calculation</p>
        </div>
        {portfolio.positions.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No positions yet.{" "}
            {!archived && (
              <Link href={`/portfolios/${portfolio.id}/add`} className="text-blue-700 hover:underline dark:text-blue-400">
                Add the first position
              </Link>
            )}
          </p>
        ) : (
          <PositionsTable portfolioId={portfolio.id} rows={portfolio.positions} selectedId={selected?.positionId} />
        )}
      </section>

      <UnvaluedSection portfolioId={portfolio.id} rows={portfolio.positions} />

      <MethodologyDisclosure />
    </div>
  );
}
