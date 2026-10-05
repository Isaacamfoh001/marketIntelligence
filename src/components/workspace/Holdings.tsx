// ---------------------------------------------------------------------------
// Holdings (M9.0): "What exactly do we own?" One list, four lenses. The default
// (Simple) shows instrument, value, weight, maturity and status; the other
// lenses bring forward rate sensitivity, maturity or evidence quality for the
// same holdings. Desktop is a table; narrow screens get stacked cards rather
// than a sideways-scrolling table. Lens switching is a plain link, so it works
// with no client JavaScript.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { HoldingsLens, HoldingView } from "@/lib/decision-insights";
import { formatIsoDate } from "@/lib/fixed-income";
import { ghsCompact, ghsWhole } from "@/lib/scenario-studio/format";
import { AssetBadge } from "@/components/portfolio/ui";
import { BasisBadge } from "@/components/portfolio/basis";
import { ThesisChip } from "@/components/thesis/HoldingThesis";
import type { ThesisPresence } from "@/lib/queries/thesis";
import { CLASS_VAR, FOCUS } from "./shared";

export const LENSES: { id: HoldingsLens; param: string; label: string; question: string }[] = [
  { id: "SIMPLE", param: "simple", label: "Simple", question: "What do we own, and how big is each holding?" },
  { id: "RATES", param: "rates", label: "Rates", question: "Which holdings move most when interest rates move?" },
  { id: "MATURITY", param: "maturity", label: "Maturity", question: "When does each holding pay back its principal?" },
  { id: "QUALITY", param: "quality", label: "Data quality", question: "How recent is the evidence behind each value? (Assumptions are not observed, so they have no recency.)" },
];

export const parseLens = (raw: string | undefined): HoldingsLens => LENSES.find((l) => l.param === raw)?.id ?? "SIMPLE";

const remaining = (days: number) => (days <= 365 ? `${days} ${days === 1 ? "day" : "days"}` : `${(days / 365).toFixed(1)} years`);
const wt = (n: number) => `${n.toFixed(n >= 10 ? 0 : 1)}%`;

export function StatusChip({ h }: { h: HoldingView }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium";
  if (h.status === "UNVALUED") return <span className={`${base} border border-dashed border-zinc-400 text-zinc-700 dark:border-zinc-500 dark:text-zinc-300`}>Needs review</span>;
  // Evidence recency is a data-quality question; an assumption has no observation, so it is neither recent nor older.
  if (h.basis === "ANALYST_ASSUMPTION") return <span className={`${base} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>Not observed</span>;
  if (h.quality.recency === "STALE") return <span className={`${base} bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300`}>Older evidence</span>;
  return <span className={`${base} bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300`}>Recent</span>;
}

function Instrument({ h, href, selected, thesis }: { h: HoldingView; href: string; selected: boolean; thesis?: ThesisPresence }) {
  return (
    <div className="min-w-0">
      <Link href={href} aria-current={selected ? "true" : undefined} className={`rounded text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-100 ${FOCUS}`}>
        {h.label}
      </Link>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        <AssetBadge assetClass={h.assetClass === "EQUITY" ? "EQUITY" : h.assetClass === "TREASURY_BILL" ? "TREASURY_BILL" : "BOND"} classification={h.assetClass === "CORPORATE_BOND" ? "CORPORATE_BOND" : h.assetClass === "GOVERNMENT_BOND" ? "GOVERNMENT_BOND" : undefined} />
        <span className="truncate">{h.issuerName}</span>
      </div>
      <ThesisChip presence={thesis} />
    </div>
  );
}

function Weight({ h }: { h: HoldingView }) {
  if (h.referenceValueGhs === null || h.weightPct === null) {
    return (
      <div>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Not valued</span>
        <p className="mt-1"><BasisBadge basis="UNVALUED" /></p>
        {h.canAssume && <p className="mt-1 max-w-[14rem] text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">No reliable Reference Value. You can keep it unvalued or open it to add an assumption.</p>}
      </div>
    );
  }
  return (
    <div>
      <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {ghsWhole(h.referenceValueGhs)} <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">{wt(h.weightPct)}</span>
      </p>
      <div className="mt-1 h-1.5 w-full max-w-[9rem] overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, h.weightPct)}%`, background: CLASS_VAR[h.assetClass] }} />
      </div>
      <p className="mt-1.5"><BasisBadge basis={h.basis} detail={h.assumptionSummary} /></p>
      {h.korblyValueGhs !== null && <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Korbly’s own value: {ghsWhole(h.korblyValueGhs)}</p>}
    </div>
  );
}

const maturityText = (h: HoldingView) => (h.maturityDate && h.daysToMaturity !== null ? `${formatIsoDate(h.maturityDate)} · in ${remaining(h.daysToMaturity)}` : "—");

function RateCell({ h }: { h: HoldingView }) {
  if (!h.rate) return <span className="text-sm text-zinc-400 dark:text-zinc-500">{h.assetClass === "EQUITY" ? "Not rate-sensitive" : "Not available"}</span>;
  return (
    <div>
      <p className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">≈ {ghsCompact(h.rate.per1ppGhs)} per 1 percentage point</p>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{wt(h.rate.sleeveSharePct)} of {h.rate.kind === "BOND_YIELD" ? "bond" : "Treasury-bill"} rate sensitivity</p>
    </div>
  );
}

/** Technical figures for experts, one disclosure away from the plain value. */
function RateTechnical({ h }: { h: HoldingView }) {
  if (!h.rate) return null;
  return (
    <details className="mt-1">
      <summary className={`cursor-pointer list-none rounded text-[11px] text-blue-700 hover:underline dark:text-blue-400 ${FOCUS}`}>Technical</summary>
      <p className="mt-1 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
        DV01 GHS {h.rate.dv01Ghs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per 0.01 pp · modified duration {h.rate.modifiedDurationYears.toFixed(2)} yrs
      </p>
    </details>
  );
}

function QualityCell({ h }: { h: HoldingView }) {
  return (
    <div>
      <p className="text-sm text-zinc-900 dark:text-zinc-100">{h.quality.label}</p>
      {h.quality.inputDate && <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Observed {formatIsoDate(h.quality.inputDate)}</p>}
      {h.quality.note && <p className="mt-0.5 max-w-sm text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{h.quality.note}</p>}
    </div>
  );
}

const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
const TD = "px-3 py-3 align-top";

export function HoldingsView({ portfolioId, holdings, lens, selectedId, valueLabel = "Reference Value", thesisPresence }: { portfolioId: string; holdings: HoldingView[]; lens: HoldingsLens; selectedId?: string; /** Live-thesis presence by positionId (M9.1). Optional. */ thesisPresence?: Record<string, ThesisPresence>; /** "Reference Value", or "Analytical Starting Value" when assumptions participate. */ valueLabel?: string }) {
  const lensMeta = LENSES.find((l) => l.id === lens)!;
  const hrefFor = (h: HoldingView) => `/portfolios/${portfolioId}?view=holdings&lens=${lensMeta.param}&position=${h.positionId}#inspect`;
  return (
    <div>
      <div role="group" aria-label="Holdings perspective" className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/70 sm:inline-flex">
        {LENSES.map((l) => (
          <Link key={l.id} href={`/portfolios/${portfolioId}?view=holdings&lens=${l.param}`} scroll={false} aria-current={l.id === lens ? "true" : undefined} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${FOCUS} ${l.id === lens ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>
            {l.label}
          </Link>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{lensMeta.question}</p>

      {/* Wide screens: table */}
      <div className="mt-3 hidden overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Holdings — {lensMeta.label} perspective</caption>
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <tr>
              <th scope="col" className={TH}>Instrument</th>
              {lens === "SIMPLE" && (
                <>
                  <th scope="col" className={TH}>{valueLabel} · weight</th>
                  <th scope="col" className={TH}>Matures</th>
                  <th scope="col" className={TH}>Status</th>
                </>
              )}
              {lens === "RATES" && (
                <>
                  <th scope="col" className={TH}>Rate sensitivity</th>
                  <th scope="col" className={TH}>{valueLabel}</th>
                </>
              )}
              {lens === "MATURITY" && (
                <>
                  <th scope="col" className={TH}>Matures</th>
                  <th scope="col" className={TH}>Principal</th>
                  <th scope="col" className={TH}>{valueLabel}</th>
                </>
              )}
              {lens === "QUALITY" && (
                <>
                  <th scope="col" className={TH}>Evidence</th>
                  <th scope="col" className={TH}>Status</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {holdings.map((h) => (
              <tr key={h.positionId} className={selectedId === h.positionId ? "bg-blue-50/60 dark:bg-blue-900/10" : "hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30"}>
                <td className={TD}><Instrument h={h} href={hrefFor(h)} selected={selectedId === h.positionId} thesis={thesisPresence?.[h.positionId]} /></td>
                {lens === "SIMPLE" && (
                  <>
                    <td className={TD}><Weight h={h} /><p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{h.sizeText}</p></td>
                    <td className={`${TD} text-sm text-zinc-700 dark:text-zinc-300`}>{maturityText(h)}</td>
                    <td className={TD}><StatusChip h={h} /></td>
                  </>
                )}
                {lens === "RATES" && (
                  <>
                    <td className={TD}><RateCell h={h} /><RateTechnical h={h} /></td>
                    <td className={TD}><Weight h={h} /></td>
                  </>
                )}
                {lens === "MATURITY" && (
                  <>
                    <td className={`${TD} text-sm text-zinc-700 dark:text-zinc-300`}>{maturityText(h)}</td>
                    <td className={`${TD} text-sm tabular-nums text-zinc-900 dark:text-zinc-100`}>{h.maturityDate ? h.sizeText : "—"}</td>
                    <td className={TD}><Weight h={h} /></td>
                  </>
                )}
                {lens === "QUALITY" && (
                  <>
                    <td className={TD}><QualityCell h={h} /></td>
                    <td className={TD}><StatusChip h={h} /></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: stacked cards */}
      <ul className="mt-3 space-y-2 md:hidden" aria-label={`Holdings — ${lensMeta.label} perspective`}>
        {holdings.map((h) => (
          <li key={h.positionId} className={`rounded-xl border p-4 ${selectedId === h.positionId ? "border-blue-300 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-900/10" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}>
            <div className="flex items-start justify-between gap-3">
              <Instrument h={h} href={hrefFor(h)} selected={selectedId === h.positionId} thesis={thesisPresence?.[h.positionId]} />
              <StatusChip h={h} />
            </div>
            <div className="mt-3 space-y-2">
              {(lens === "SIMPLE" || lens === "RATES" || lens === "MATURITY") && <Weight h={h} />}
              {lens === "SIMPLE" && (
                <>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{h.sizeText}</p>
                  {h.maturityDate && <p className="text-xs text-zinc-600 dark:text-zinc-300">Matures: {maturityText(h)}</p>}
                </>
              )}
              {lens === "RATES" && (
                <>
                  <RateCell h={h} />
                  <RateTechnical h={h} />
                </>
              )}
              {lens === "MATURITY" && (
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  {maturityText(h)}
                  {h.maturityDate ? ` · ${h.sizeText}` : ""}
                </p>
              )}
              {lens === "QUALITY" && <QualityCell h={h} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
