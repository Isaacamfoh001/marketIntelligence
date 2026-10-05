"use client";

// ---------------------------------------------------------------------------
// Searchable instrument picker for "Add position" (M8.1 §18). Bonds and
// equities are visually distinct; each option shows what the valuation would
// rest on (or why it cannot be valued today). Instruments that can never be
// held (matured, floating-rate, non-GHS, inactive) are hidden by default and
// shown disabled with the reason on request. An instrument already in the
// portfolio links to its existing position instead of offering a second lot.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useMemo, useState } from "react";
import { UNVALUED_LABEL } from "@/lib/portfolio";
import { formatIsoDate, formatPct } from "@/lib/fixed-income";
import type { BondInstrument, EquityInstrument } from "@/lib/queries/portfolio";
import type { FormState } from "@/app/portfolios/actions";
import { PositionSizeForm } from "./PositionSizeForm";
import { AssetBadge, ageText, formatPrice, RecencyBadge } from "./ui";

type Filter = "ALL" | "GOVERNMENT_BOND" | "CORPORATE_BOND" | "EQUITY";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "GOVERNMENT_BOND", label: "Government bonds" },
  { id: "CORPORATE_BOND", label: "Corporate bonds" },
  { id: "EQUITY", label: "Equities" },
];

type PickerInstrument = BondInstrument | EquityInstrument;
const searchText = (i: PickerInstrument) => (i.kind === "BOND" ? `${i.label} ${i.issuerName} ${i.instrumentCode}` : `${i.ticker} ${i.companyName}`).toLowerCase();

function BondContext({ b }: { b: BondInstrument }) {
  if (b.input.available) {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        Observed yield {formatPct(b.input.observedYtmPct)} · {formatIsoDate(b.input.observationDate)} ({ageText(b.input.ageDays)}) <RecencyBadge recency={b.input.recency} />
      </span>
    );
  }
  return <span className="text-[11px] text-amber-700 dark:text-amber-400">Cannot be valued today — {UNVALUED_LABEL[b.input.code].toLowerCase()}</span>;
}

function EquityContext({ e }: { e: EquityInstrument }) {
  if (e.input.available) {
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        Last traded GHS {formatPrice(e.input.priceGhs)} · {formatIsoDate(e.input.priceDate)} ({ageText(e.input.ageDays)}) <RecencyBadge recency={e.input.recency} />
      </span>
    );
  }
  return <span className="text-[11px] text-amber-700 dark:text-amber-400">Cannot be valued today — {UNVALUED_LABEL[e.input.code].toLowerCase()}</span>;
}

export function InstrumentPicker({
  bonds,
  equities,
  held,
  portfolioId,
  valuationDateIso,
  action,
}: {
  bonds: BondInstrument[];
  equities: EquityInstrument[];
  /** instrumentId → positionId for instruments already in this portfolio. */
  held: Record<string, string>;
  portfolioId: string;
  valuationDateIso: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [showBlocked, setShowBlocked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const all: PickerInstrument[] = useMemo(() => [...bonds, ...equities], [bonds, equities]);
  const blockedCount = all.filter((i) => !i.addable.addable).length;
  const q = query.trim().toLowerCase();
  const visible = all.filter((i) => {
    if (!showBlocked && !i.addable.addable) return false;
    if (filter === "EQUITY" ? i.kind !== "EQUITY" : filter !== "ALL" && (i.kind !== "BOND" || i.instrumentType !== filter)) return false;
    return q === "" || searchText(i).includes(q);
  });
  const selected = all.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search issuer, ticker or code"
            aria-label="Search instruments"
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Instrument type">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-2.5 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${filter === f.id ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-300"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {blockedCount > 0 && (
          <label className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} />
            Show {blockedCount} instruments that cannot be added (matured, floating-rate, non-GHS, inactive)
          </label>
        )}

        <ul className="mt-3 max-h-[28rem] divide-y divide-zinc-100 overflow-y-auto rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label="Instruments">
          {visible.length === 0 && <li className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No instruments match.</li>}
          {visible.map((i) => {
            const heldPositionId = held[i.id];
            const isSelected = selectedId === i.id;
            const body = (
              <span className="flex min-w-0 flex-col gap-0.5 text-left">
                <span className="flex flex-wrap items-center gap-1.5">
                  <AssetBadge assetClass={i.kind} classification={i.kind === "BOND" ? i.instrumentType : undefined} />
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{i.kind === "BOND" ? i.label : i.ticker}</span>
                  {heldPositionId && <span className="rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-600 dark:text-zinc-300">In portfolio</span>}
                </span>
                <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {i.kind === "BOND" ? `${i.issuerName} · ${i.couponRatePct !== null ? `${i.couponRatePct.toFixed(2)}% coupon` : "zero coupon"} · matures ${formatIsoDate(i.maturityDate)} · ${i.instrumentCode}` : i.companyName}
                </span>
                {i.addable.addable ? i.kind === "BOND" ? <BondContext b={i} /> : <EquityContext e={i} /> : <span className="text-[11px] text-red-700 dark:text-red-400">Cannot be added — {i.addable.reason}</span>}
              </span>
            );
            const rowCls = `block w-full px-3 py-2 ${isSelected ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-900"}`;
            return (
              <li key={i.id}>
                {heldPositionId ? (
                  <Link href={`/portfolios/${portfolioId}?position=${heldPositionId}&duplicate=1#inspect`} className={`${rowCls} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500`} title="Already in this portfolio — edit the existing position">
                    {body}
                  </Link>
                ) : (
                  <button type="button" disabled={!i.addable.addable} aria-pressed={isSelected} onClick={() => setSelectedId(i.id)} className={`${rowCls} focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60`}>
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
        {selected ? (
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <AssetBadge assetClass={selected.kind} classification={selected.kind === "BOND" ? selected.instrumentType : undefined} />
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{selected.kind === "BOND" ? selected.label : `${selected.ticker} — ${selected.companyName}`}</span>
            </div>
            {!selected.input.available && <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">This instrument can be recorded, but it cannot contribute to the portfolio reference value today: {selected.input.reason}</p>}
            <PositionSizeForm key={selected.id} instrument={selected} action={action} submitLabel="Add to portfolio" valuationDateIso={valuationDateIso} cancelHref={`/portfolios/${portfolioId}`} />
          </div>
        ) : (
          <div className="rounded border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">Select a bond or equity to enter its size and preview its reference value.</div>
        )}
      </div>
    </div>
  );
}
