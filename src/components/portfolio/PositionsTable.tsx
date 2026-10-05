// ---------------------------------------------------------------------------
// Positions table + the "needs attention" list (M8.1 §16). Every row states
// its valuation input, the input's date and age, its status, and either a
// reference value or "Not valued" — never a 0. Each row links to its
// drill-down (?position=<id>).
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { PositionRow } from "@/lib/queries/portfolio";
import { formatGhs, formatIsoDate, formatPct } from "@/lib/fixed-income";
import { AssetBadge, ageText, formatInt, formatPrice, RecencyBadge, UnvaluedBadge } from "./ui";

// Compact cell padding so the eight columns fit a laptop viewport beside the sidebar.
const TH = "px-2 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
const TD = "whitespace-nowrap px-2 py-2";
const NUM = "whitespace-nowrap px-2 py-2 text-right tabular-nums";

const instrumentName = (r: PositionRow) => (r.instrument.kind === "EQUITY" ? r.instrument.ticker : r.instrument.label);
const instrumentSub = (r: PositionRow) => (r.instrument.kind === "BOND" ? `${r.instrument.issuerName} · ${r.instrument.instrumentCode}` : r.instrument.kind === "TREASURY_BILL" ? `${r.instrument.issuerName} · matures ${formatIsoDate(r.instrument.maturityDate)}` : r.instrument.companyName);
const sizeText = (r: PositionRow) => (r.holding.assetClass === "BOND" ? formatGhs(r.holding.nominalGhs) : r.holding.assetClass === "TREASURY_BILL" ? `${formatGhs(r.holding.faceValueGhs)} face` : `${formatInt(r.holding.shares)} shares`);

export function PositionsTable({ portfolioId, rows, selectedId }: { portfolioId: string; rows: PositionRow[]; selectedId?: string }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[50rem] border-collapse text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
          <tr>
            <th className={`${TH} text-left`}>Instrument</th>
            <th className={`${TH} text-left`}>Asset class</th>
            <th className={`${TH} text-right`}>Position size</th>
            <th className={`${TH} text-left`}>Valuation input</th>
            <th className={`${TH} text-left`}>Input date</th>
            <th className={`${TH} text-left`}>Status</th>
            <th className={`${TH} text-right`}>Reference price</th>
            <th className={`${TH} text-right`}>Reference value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => {
            const v = r.valuation;
            const selected = selectedId === r.positionId;
            return (
              <tr key={r.positionId} className={selected ? "bg-blue-50/60 dark:bg-blue-900/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/40"}>
                <td className={TD}>
                  <Link href={`/portfolios/${portfolioId}?position=${r.positionId}#inspect`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100" aria-current={selected ? "true" : undefined}>
                    {instrumentName(r)}
                  </Link>
                  <div className="max-w-[10rem] truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={instrumentSub(r)}>
                    {instrumentSub(r)}
                  </div>
                </td>
                <td className={TD}>
                  <AssetBadge assetClass={r.holding.assetClass} classification={r.instrument.kind === "BOND" ? r.instrument.instrumentType : undefined} />
                </td>
                <td className={NUM}>{sizeText(r)}</td>
                <td className={TD}>
                  {v.status === "VALUED" && v.detail.assetClass === "BOND" && <span>{v.basis === "ANALYST_ASSUMPTION" ? "Assumed" : "Observed"} yield {formatPct(v.detail.observedYtmPct)}</span>}
                  {v.status === "VALUED" && v.detail.assetClass === "EQUITY" && <span>{v.basis === "ANALYST_ASSUMPTION" ? "Assumed price" : "Last traded"} GHS {formatPrice(v.detail.priceGhs)}</span>}
                  {v.status === "VALUED" && v.detail.assetClass === "TREASURY_BILL" && <span title={v.detail.methodDescription}>{v.basis === "ANALYST_ASSUMPTION" ? "Assumed rate" : "Auction-based rate"} {formatPct(v.detail.referenceRatePct)}</span>}
                  {v.status === "UNVALUED" && <span className="text-zinc-400 dark:text-zinc-500">No usable input</span>}
                </td>
                <td className={TD}>
                  {v.status === "VALUED" ? (
                    <>
                      <span className="text-xs text-zinc-700 dark:text-zinc-300">{formatIsoDate(v.inputDate)}</span>
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{ageText(v.inputAgeDays)}</div>
                    </>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-500">—</span>
                  )}
                </td>
                <td className={TD}>{v.status === "VALUED" ? <RecencyBadge recency={v.recency} /> : <UnvaluedBadge code={v.code} />}</td>
                <td className={NUM}>
                  {v.status === "VALUED" ? (
                    v.detail.assetClass === "BOND" ? (
                      <span title={`Reference clean price per ${v.detail.faceValue} face, rolled to the valuation date`}>{formatPrice(v.detail.referenceCleanPrice)}</span>
                    ) : v.detail.assetClass === "TREASURY_BILL" ? (
                      <span title="Reference price per 100 of face value">{formatPrice(v.detail.referencePricePer100)}</span>
                    ) : (
                      <span>GHS {formatPrice(v.detail.priceGhs)}</span>
                    )
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-500">—</span>
                  )}
                </td>
                <td className={`${NUM} font-medium`}>{v.status === "VALUED" ? formatGhs(v.referenceValueGhs) : <span className="font-normal text-zinc-500 dark:text-zinc-400">Not valued</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Positions that cannot be responsibly valued, each with the reason and the evidence/action available. */
export function UnvaluedSection({ portfolioId, rows }: { portfolioId: string; rows: PositionRow[] }) {
  const unvalued = rows.filter((r) => r.valuation.status === "UNVALUED");
  if (unvalued.length === 0) return null;
  return (
    <section aria-labelledby="needs-attention">
      <h2 id="needs-attention" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Unvalued / needs attention <span className="font-normal normal-case text-zinc-400">— {unvalued.length} {unvalued.length === 1 ? "position" : "positions"}, not counted in the reference value</span>
      </h2>
      <ul className="divide-y divide-zinc-100 rounded border border-amber-200 bg-amber-50/40 dark:divide-zinc-800 dark:border-amber-900/50 dark:bg-amber-900/10">
        {unvalued.map((r) => {
          const v = r.valuation;
          if (v.status !== "UNVALUED") return null;
          return (
            <li key={r.positionId} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,2.5fr)] sm:gap-4">
              <div>
                <Link href={`/portfolios/${portfolioId}?position=${r.positionId}#inspect`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
                  {instrumentName(r)}
                </Link>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{instrumentSub(r)}</div>
              </div>
              <div className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">{sizeText(r)}</div>
              <div className="text-sm text-zinc-700 dark:text-zinc-300">
                <UnvaluedBadge code={v.code} /> <span className="ml-1">{v.reason}</span>
                <div className="mt-1 text-xs">
                  {r.instrument.kind === "TREASURY_BILL" ? (
                    <Link href="/macro-rates#treasury-bills" className="text-blue-700 hover:underline dark:text-blue-400">
                      Check the Bank of Ghana auction rates on Macro &amp; Rates
                    </Link>
                  ) : r.instrument.kind === "BOND" ? (
                    <Link href={`/fixed-income/${encodeURIComponent(r.instrument.instrumentCode)}#evidence`} className="text-blue-700 hover:underline dark:text-blue-400">
                      View this bond&rsquo;s evidence in Fixed Income
                    </Link>
                  ) : (
                    <Link href="/data-centre" className="text-blue-700 hover:underline dark:text-blue-400">
                      Check the GSE price data in the Data Centre
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
