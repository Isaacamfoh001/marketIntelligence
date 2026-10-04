// ---------------------------------------------------------------------------
// Analyst panel for one security (M7.4 §F): what do I know, what stands out,
// what don't I know, what should I investigate. Pure presentation of
// buildDecisionSupport — every sentence was produced by deterministic rules
// from stored facts. Server-renderable (no hooks).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { formatIsoDate, formatPct, type DecisionSupport } from "@/lib/fixed-income";
import { BenchmarkCell, Card, FreshnessBadge, Missing, ObservationKindBadge } from "./ui";

const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400";

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{value}</div>
      {sub && <div className="text-[11px] text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

export function DecisionPanel({
  support,
  isCorporate,
  freshness,
  observationKind,
}: {
  support: DecisionSupport;
  isCorporate: boolean;
  freshness: "CURRENT" | "STALE" | "MISSING";
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null;
}) {
  const { market: m, relativeValue: rv } = support;
  const reliable = m.ytmPct !== null && m.tradeDate !== null;
  const size = m.lastTradeSize;

  return (
    <Card className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-5">
      <div className="space-y-5 lg:col-span-3">
        {/* ------------------------------------------------ what do I know */}
        <div>
          <p className={LABEL}>Market observation</p>
          {reliable ? (
            <>
              <div className="mt-1.5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Fact label="Latest reliable yield" value={formatPct(m.ytmPct!)} sub={m.ytmSource === "SOURCE_QUOTED" ? "as quoted by source" : "solved from traded price"} />
                <Fact label="Price" value={m.cleanPrice !== null ? m.cleanPrice.toFixed(2) : <Missing short="Not reported" reason="The observation reports a yield but no price." />} sub="clean, per 100 face" />
                <Fact
                  label={observationKind === "AUCTION_PRIMARY" ? "Auction date" : "Trade date"}
                  value={formatIsoDate(m.tradeDate!)}
                  sub={
                    <span className="inline-flex flex-wrap items-center gap-1">
                      {m.ageDays} day{m.ageDays === 1 ? "" : "s"} ago <FreshnessBadge freshness={freshness} />
                    </span>
                  }
                />
                <Fact
                  label="Trade dates on record"
                  value={m.tradeDays}
                  sub={
                    <>
                      {m.firstTradeDate ? `since ${formatIsoDate(m.firstTradeDate)}` : null}
                      {size && (size.trades !== null || size.volumeGhs !== null) && (
                        <span className="block">
                          last: {size.trades !== null ? `${size.trades} trade${size.trades === 1 ? "" : "s"}` : ""}
                          {size.trades !== null && size.volumeGhs !== null ? ", " : ""}
                          {size.volumeGhs !== null ? `GHS ${Math.round(size.volumeGhs).toLocaleString("en-GB")}` : ""}
                        </span>
                      )}
                    </>
                  }
                />
              </div>
              {observationKind && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                  <ObservationKindBadge kind={observationKind} /> Observed market data — hypothetical scenarios are shown separately below.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              {m.state === "NEEDS_REVIEW" ? "The latest observation is withheld from analytics until reviewed (see below)." : m.state === "CARRIED_ONLY" ? "Carried price only — no market quote." : m.state === "NO_QUOTE" ? "No market quote." : "No reliable observed yield."}
            </p>
          )}
        </div>

        {/* ------------------------------------------------ relative value */}
        {isCorporate && (
          <div>
            <p className={LABEL}>Relative value context</p>
            <div className="mt-1.5">
              <BenchmarkCell ctx={rv} compact={false} align="left" observed={reliable ? { yieldPct: m.ytmPct!, date: m.tradeDate! } : undefined} />
            </div>
          </div>
        )}

        {/* ------------------------------------------------ what stands out */}
        <div>
          <p className={LABEL}>What stands out</p>
          {support.standsOut.length === 0 ? (
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">Nothing in the stored data stands out for this security.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {support.standsOut.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-5 lg:col-span-2 lg:border-l lg:border-zinc-100 lg:pl-6 dark:lg:border-zinc-800">
        {/* ------------------------------------------------ what should I investigate */}
        <div>
          <p className={LABEL}>Questions to investigate</p>
          {support.questions.length === 0 ? (
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">No prompts apply.</p>
          ) : (
            <ol className="mt-1.5 list-decimal space-y-1.5 pl-4 text-sm text-zinc-800 marker:text-zinc-400 dark:text-zinc-200">
              {support.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
          )}
          <p className="mt-1 text-[10px] text-zinc-400 dark:text-zinc-500">Prompts for analysis, not recommendations.</p>
        </div>

        {/* ------------------------------------------------ what don't I know */}
        <div>
          <p className={LABEL}>Data limitations</p>
          <ul className="mt-1.5 space-y-1">
            {support.limitations.map((t, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap gap-2">
          {support.actions.map((a, i) => {
            const cls =
              i === 0
                ? "rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                : "rounded border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
            return a.href.startsWith("#") ? (
              <a key={a.id} href={a.href} className={cls}>
                {a.label}
              </a>
            ) : (
              <Link key={a.id} href={a.href} className={cls}>
                {a.label}
              </Link>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
