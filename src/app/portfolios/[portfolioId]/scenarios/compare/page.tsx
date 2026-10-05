import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstrumentContext, getPortfolio } from "@/lib/queries/portfolio";
import { getScenarioComparison, getScenarios } from "@/lib/queries/scenarios";
import { MAX_COMPARED, MIN_COMPARED } from "@/lib/scenario-studio";
import { ComparisonView } from "@/components/scenario/ScenarioComparison";
import { HypotheticalBanner } from "@/components/scenario/ScenarioStudio";

export const dynamic = "force-dynamic";

const BTN2 = "rounded border border-zinc-300 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

// Compare two or three saved scenarios. ONE portfolio snapshot (one valuation
// date, one set of reference valuations) is loaded for the whole request and
// every scenario is run against it, so differences come only from assumptions.
export default async function ComparePage({ params, searchParams }: { params: Promise<{ portfolioId: string }>; searchParams: Promise<{ ids?: string | string[] }> }) {
  const { portfolioId } = await params;
  const query = await searchParams;
  const ctx = await getInstrumentContext();
  const portfolio = await getPortfolio(portfolioId, ctx);
  if (!portfolio) notFound();

  const requested = [...new Set((Array.isArray(query.ids) ? query.ids : query.ids ? [query.ids] : []).filter(Boolean))];
  const chosen = requested.slice(0, MAX_COMPARED);
  const available = await getScenarios(portfolio.id, { archived: false });
  const availableIds = new Set(available.map((s) => s.id));
  const usable = chosen.filter((id) => availableIds.has(id));
  const { comparison, invalid, missing } = usable.length >= MIN_COMPARED ? await getScenarioComparison(portfolio, ctx, usable) : { comparison: null, invalid: [], missing: [] };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/portfolios" className="hover:underline">
            Portfolios
          </Link>{" "}
          /{" "}
          <Link href={`/portfolios/${portfolio.id}`} className="hover:underline">
            {portfolio.name}
          </Link>{" "}
          /{" "}
          <Link href={`/portfolios/${portfolio.id}/scenarios`} className="hover:underline">
            Scenario Studio
          </Link>
        </nav>
        <h1 className="mt-0.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Compare views</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">How different are the consequences of different assumptions about the world? Pick two or three saved scenarios.</p>
      </header>

      <HypotheticalBanner />

      <details open={!comparison} className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer select-none text-sm font-medium text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-100">{comparison ? "Change the scenarios compared" : "Choose scenarios"}</summary>
        <form method="get" className="mt-3">
        {available.length < MIN_COMPARED ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You need at least two saved scenarios to compare.{" "}
            <Link href={`/portfolios/${portfolio.id}/scenarios`} className="text-blue-700 hover:underline dark:text-blue-400">
              Go to Scenario Studio
            </Link>
          </p>
        ) : (
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Scenarios to compare (up to {MAX_COMPARED})</legend>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {available.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                    <input type="checkbox" name="ids" value={s.id} defaultChecked={usable.includes(s.id)} className="h-4 w-4" />
                    {s.name}
                  </label>
                </li>
              ))}
            </ul>
            <button type="submit" className={`${BTN2} mt-3`}>
              Compare
            </button>
          </fieldset>
        )}
        </form>
      </details>

      {requested.length > MAX_COMPARED && <p className="text-xs text-zinc-500 dark:text-zinc-400">Only the first {MAX_COMPARED} selected scenarios are compared.</p>}
      {(invalid.length > 0 || missing.length > 0) && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200">
          {invalid.length > 0 && `These scenarios cannot be run and were left out: ${invalid.join(", ")}. `}
          {missing.length > 0 && `${missing.length} selected scenario${missing.length === 1 ? " was" : "s were"} not found.`}
        </p>
      )}
      {comparison ? <ComparisonView portfolioId={portfolio.id} c={comparison} /> : usable.length < MIN_COMPARED && requested.length > 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Select at least two scenarios to compare.</p> : null}
    </div>
  );
}
