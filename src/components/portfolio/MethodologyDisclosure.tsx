import { BOND_RECENT_WINDOW_DAYS, EQUITY_RECENT_WINDOW_DAYS, REFERENCE_VALUE_DEFINITION } from "@/lib/portfolio";

/** Progressive disclosure of how a reference value is built (M8.1 §16) — collapsed by default so the headline view stays calm. */
export function MethodologyDisclosure() {
  return (
    <details className="group rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-zinc-200">Valuation methodology</summary>
      <div className="space-y-3 border-t border-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <div>
          <h3 className="font-medium text-zinc-800 dark:text-zinc-200">What &ldquo;Reference value&rdquo; means</h3>
          <p className="mt-0.5">{REFERENCE_VALUE_DEFINITION}</p>
        </div>
        <div>
          <h3 className="font-medium text-zinc-800 dark:text-zinc-200">Bonds — yield-rolled</h3>
          <p className="mt-0.5">
            The latest reliable observed yield (a secondary-market trade that passed Fixed Income&rsquo;s data-quality checks) is held constant and the bond is re-priced from its contractual cash flows to today&rsquo;s valuation date. Reference value = nominal × dirty price ÷ face value, where dirty price = clean price + accrued interest. The observed yield stays tied to its own observation date; the historical traded price is shown beside the rolled price but never merged with it. The one assumption — that the yield has not changed since it was observed — is stated on every bond.
          </p>
        </div>
        <div>
          <h3 className="font-medium text-zinc-800 dark:text-zinc-200">Equities — last actual trade</h3>
          <p className="mt-0.5">
            Reference value = shares × the GSE closing price (VWAP) on the most recent day the share actually traded (volume above zero). GSE re-prints the previous close on days with no trading, so those rows are skipped and the price keeps its true trade date.
          </p>
        </div>
        <div>
          <h3 className="font-medium text-zinc-800 dark:text-zinc-200">Why stale inputs stay stale</h3>
          <p className="mt-0.5">
            A bond observation is recent within {BOND_RECENT_WINDOW_DAYS} days of the valuation date and an equity trade within {EQUITY_RECENT_WINDOW_DAYS} days. Older observations are still used if they are reliable, but they are labelled stale, and the coverage panel shows how much of the reference value rests on them. Rolling a yield forward does not make an old observation current.
          </p>
        </div>
        <div>
          <h3 className="font-medium text-zinc-800 dark:text-zinc-200">Why some positions are not valued</h3>
          <p className="mt-0.5">
            A position is left out — never valued at zero — when there is no reliable input: the bond has matured, has floating-rate or incomplete terms, has only carried prices or no trades, or its latest observation is under data-quality review with no earlier reliable one; or the share has never traded in the data held. Positions are valued as of today; Korbly does not estimate or fill gaps.
          </p>
        </div>
      </div>
    </details>
  );
}
