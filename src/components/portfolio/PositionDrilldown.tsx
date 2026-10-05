// ---------------------------------------------------------------------------
// Position drill-down (M8.1 §17): the full calculation, the provenance of the
// observation behind it, and edit/remove controls. Server-rendered from
// ?position=<id>, so it is linkable and works without client JS for removal.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { InputProvenance, PositionRow } from "@/lib/queries/portfolio";
import { formatIsoDate } from "@/lib/fixed-income";
import { removeAssumptionAction, removePositionAction, saveAssumptionAction, updatePositionAction } from "@/app/portfolios/actions";
import { assumptionAvailability, kindsFor, type AssumptionSubject } from "@/lib/portfolio";
import { billDaysToMaturity } from "@/lib/treasury-bills";
import { AssumptionEditor } from "./AssumptionEditor";
import { BasisBadge } from "./basis";
import { PositionSizeForm } from "./PositionSizeForm";
import { ValuationBreakdown } from "./ValuationBreakdown";
import { AssetBadge } from "./ui";
import { ThesisPanel } from "@/components/thesis/HoldingThesis";
import type { ThesisPresence } from "@/lib/queries/thesis";

export function PositionDrilldown({
  portfolioId,
  row,
  provenance,
  valuationDateIso,
  notice,
  archived = false,
  thesis,
  createThesisHref,
}: {
  portfolioId: string;
  row: PositionRow;
  provenance: InputProvenance | null;
  valuationDateIso: string;
  notice?: "duplicate" | "saved" | "assumed" | "unassumed";
  archived?: boolean;
  /** Live-thesis presence for this holding, and where "Create thesis" goes (M9.1). */
  thesis?: ThesisPresence;
  createThesisHref?: string;
}) {
  const { instrument, holding, valuation } = row;
  const title = instrument.kind === "EQUITY" ? `${instrument.ticker} — ${instrument.companyName}` : instrument.label;
  const initial = holding.assetClass === "BOND" ? String(holding.nominalGhs) : holding.assetClass === "TREASURY_BILL" ? String(holding.faceValueGhs) : String(holding.shares);
  const update = updatePositionAction.bind(null, portfolioId, row.positionId, holding.assetClass);
  const remove = removePositionAction.bind(null, portfolioId, row.positionId);

  // Valuation assumption (M9.0.1): what Korbly itself supports, what may be assumed, and the plain facts the editor needs.
  const valuationDate = new Date(`${valuationDateIso}T00:00:00.000Z`);
  const subject: AssumptionSubject =
    holding.assetClass === "BOND" && instrument.kind === "BOND"
      ? { assetClass: "BOND", nominalGhs: holding.nominalGhs, terms: instrument.terms }
      : holding.assetClass === "TREASURY_BILL" && instrument.kind === "TREASURY_BILL"
        ? { assetClass: "TREASURY_BILL", faceValueGhs: holding.faceValueGhs, daysToMaturity: billDaysToMaturity(new Date(`${instrument.maturityDate}T00:00:00.000Z`), valuationDate) }
        : { assetClass: "EQUITY", shares: holding.assetClass === "EQUITY" ? holding.shares : 0 };
  const korbly = row.korblyValuation;
  const korblyStanding = {
    status: korbly.status,
    basisLabel: korbly.status === "VALUED" ? (korbly.basis === "INDICATIVE" ? "Indicative" : "Reference") : null,
    valueGhs: korbly.status === "VALUED" ? korbly.referenceValueGhs : null,
    reason: korbly.status === "UNVALUED" ? korbly.reason : null,
    availability: korbly.status === "VALUED" ? ({ assumable: true, kinds: kindsFor(holding.assetClass) } as const) : assumptionAvailability(holding.assetClass, korbly.code),
  };
  const basis = valuation.status === "VALUED" ? valuation.basis : "UNVALUED";

  return (
    <section id="inspect" aria-label={`Position detail: ${title}`} className="scroll-mt-4 rounded border border-blue-200 bg-white p-4 dark:border-blue-900/60 dark:bg-zinc-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Position detail</p>
          <h2 className="mt-0.5 flex flex-wrap items-center gap-1.5 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            <AssetBadge assetClass={holding.assetClass} classification={instrument.kind === "BOND" ? instrument.instrumentType : undefined} />
            {title}
            <BasisBadge basis={basis} detail={valuation.status === "VALUED" && valuation.assumption ? valuation.assumption.summary : null} />
          </h2>
          {instrument.kind === "TREASURY_BILL" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {instrument.issuerName} · {instrument.tenorDays}-day bill · issued {formatIsoDate(instrument.issueDate)} · matures {formatIsoDate(instrument.maturityDate)}
              {instrument.isin ? ` · ${instrument.isin}` : ""} · no coupon: one payment of face value at maturity
            </p>
          )}
          {instrument.kind === "BOND" && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {instrument.issuerName} · {instrument.couponRatePct !== null ? `${instrument.couponRatePct.toFixed(2)}% coupon` : "zero coupon"} · matures {formatIsoDate(instrument.maturityDate)} ·{" "}
              <Link href={`/fixed-income/${encodeURIComponent(instrument.instrumentCode)}`} className="text-blue-700 hover:underline dark:text-blue-400">
                open in Fixed Income
              </Link>
            </p>
          )}
        </div>
        <Link href={`/portfolios/${portfolioId}`} className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          Close
        </Link>
      </div>

      {notice === "duplicate" && <p role="status" className="mb-3 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-200">This instrument is already in the portfolio — a portfolio holds one position per instrument. Edit its size here.</p>}
      {notice === "assumed" && <p role="status" className="mb-3 rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-900 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-200">Assumption saved. The analysis now uses it and labels it as an assumption.</p>}
      {notice === "unassumed" && <p role="status" className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Assumption removed. The holding is back to {valuation.status === "VALUED" ? "Korbly’s own valuation" : "unvalued"}.</p>}
      {notice === "saved" && <p role="status" className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-200">Position saved.</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Calculation</h3>
          <ValuationBreakdown valuation={valuation} />
        </div>

        <div className="space-y-5">
          {thesis && createThesisHref && <ThesisPanel presence={thesis} createHref={createThesisHref} />}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Valuation basis</h3>
            <AssumptionEditor
              subject={subject}
              valuationDateIso={valuationDateIso}
              korbly={korblyStanding}
              stored={row.assumption}
              inForce={valuation.status === "VALUED" && valuation.basis === "ANALYST_ASSUMPTION"}
              saveAction={saveAssumptionAction.bind(null, portfolioId, row.positionId)}
              removeAction={removeAssumptionAction.bind(null, portfolioId, row.positionId)}
              archived={archived}
            />
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source &amp; provenance</h3>
            {provenance ? (
              <>
                <dl className="text-sm">
                  {[
                    ["Source", provenance.sourceName],
                    ["Ingestion run", provenance.ingestionRunId],
                    ["Retrieved", new Date(provenance.retrievedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })],
                    ...provenance.facts.map((f) => [f.label, f.value]),
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4 border-b border-zinc-100 py-1 last:border-0 dark:border-zinc-800">
                      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
                      <dd className="min-w-0 break-words text-right text-xs tabular-nums text-zinc-800 dark:text-zinc-200">{value}</dd>
                    </div>
                  ))}
                </dl>
                {instrument.kind === "BOND" && (
                  <p className="mt-2 text-xs">
                    <Link href={`/fixed-income/${encodeURIComponent(instrument.instrumentCode)}#evidence`} className="text-blue-700 hover:underline dark:text-blue-400">
                      View full observation history and data-quality evidence
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{valuation.status === "VALUED" ? (valuation.basis === "ANALYST_ASSUMPTION" ? "This value rests on an analyst assumption, not on a market observation, so there is no market source to trace. Provenance: Analyst assumption." : "The source row for this observation could not be loaded.") : "There is no observation behind this position, so there is nothing to trace."}</p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Edit position</h3>
            <PositionSizeForm instrument={instrument} action={update} initialValue={initial} submitLabel="Save size" valuationDateIso={valuationDateIso} />
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-red-700 hover:text-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-red-400">Remove this position…</summary>
            <form action={remove} className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">Removes the position from this portfolio. The instrument and its market data are not affected.</p>
              <button type="submit" className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
                Confirm remove
              </button>
            </form>
          </details>
        </div>
      </div>
    </section>
  );
}
