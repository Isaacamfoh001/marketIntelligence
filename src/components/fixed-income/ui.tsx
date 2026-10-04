// ---------------------------------------------------------------------------
// Small presentational pieces shared by every Fixed Income surface (M7.3
// §24): one definition of the observation/freshness/lifecycle badges and
// section chrome, so a "Secondary" or "Stale" tag means the same thing and
// looks the same on the landing page, Compare, and Security Detail.
// No hooks — usable from server and client components alike.
// ---------------------------------------------------------------------------

import Link from "next/link";
import {
  BENCHMARK_DATE_WINDOW_DAYS,
  formatBps,
  formatIsoDate,
  formatPct,
  issuerShortName,
  MARKET_STATE_LABEL,
  securityShortLabel,
  type BenchmarkContext,
  type MarketState,
  type SecurityLifecycle,
} from "@/lib/fixed-income";

export const TH = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
export const TD = "whitespace-nowrap px-3 py-2";
export const NUM = "whitespace-nowrap px-3 py-2 text-right tabular-nums";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>{children}</div>;
}

export function SectionHeading({ title, question, right }: { title: string; question?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
        {question && <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{question}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, emphasis = false }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-100 ${emphasis ? "text-2xl font-semibold" : "text-base font-semibold"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

const PILL = "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap";

export function ObservationKindBadge({ kind }: { kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null }) {
  if (!kind) return null;
  return kind === "AUCTION_PRIMARY" ? (
    <span className={`${PILL} bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400`}>Primary</span>
  ) : (
    <span className={`${PILL} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>Secondary</span>
  );
}

export function FreshnessBadge({ freshness }: { freshness: "CURRENT" | "STALE" | "MISSING" }) {
  if (freshness === "STALE") return <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>Stale</span>;
  if (freshness === "CURRENT") return <span className={`${PILL} bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>Recent</span>;
  return null;
}

export function LifecycleBadge({ lifecycle }: { lifecycle: SecurityLifecycle }) {
  if (lifecycle === "MATURING_SOON") return <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>Maturing soon</span>;
  if (lifecycle === "MATURED") return <span className={`${PILL} bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}>Matured</span>;
  return null;
}

export function HypotheticalBadge() {
  return <span className={`${PILL} border border-dashed border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300`}>Hypothetical</span>;
}

/** Observation cell: date + kind + freshness, or an explicit "No market quote" — never a bare dash. */
export function ObservationCell({ dateIso, kind, freshness, align = "right" }: { dateIso: string | null; kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null; freshness: "CURRENT" | "STALE" | "MISSING"; align?: "left" | "right" }) {
  if (!dateIso) return <span className="text-xs text-zinc-400 dark:text-zinc-500">No market quote</span>;
  return (
    <div className={`flex flex-col gap-0.5 ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="text-xs text-zinc-700 dark:text-zinc-300">{formatIsoDate(dateIso)}</span>
      <span className="flex gap-1">
        <ObservationKindBadge kind={kind} />
        <FreshnessBadge freshness={freshness} />
      </span>
    </div>
  );
}

/** Security identity with the human label primary and the instrument code as secondary metadata (M7.3 §7). */
export function SecurityIdentity({ instrumentCode, issuerName, couponRatePct, maturityDate, href = true }: { instrumentCode: string; issuerName: string; couponRatePct: number | null; maturityDate: string; href?: boolean }) {
  const label = securityShortLabel(issuerName, couponRatePct, maturityDate);
  return (
    <div className="min-w-0 max-w-[13rem]">
      {href ? (
        <Link href={`/fixed-income/${encodeURIComponent(instrumentCode)}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
          {label}
        </Link>
      ) : (
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
      )}
      <div className="truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={`${issuerName} · ${instrumentCode}`}>
        {issuerShortName(issuerName) !== issuerName ? `${issuerName} · ` : ""}
        <span className="font-mono">{instrumentCode}</span>
      </div>
    </div>
  );
}

/** A missing value with its reason as a tooltip — concise in the cell, explicit on hover (M7.3 §21). */
export function Missing({ reason, short = "—" }: { reason: string; short?: string }) {
  return (
    <span className="cursor-help text-zinc-400 dark:text-zinc-500" title={reason}>
      {short}
    </span>
  );
}

export function signedTone(value: number): string {
  return value < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100";
}

/**
 * Data-quality badge (M7.3.1 §23) — rendered ONLY when attention is needed;
 * a VALID observation shows nothing. The evidence is in the tooltip and
 * accessible label so the reason is one hover away, never hidden.
 */
export function QualityBadge({ status, issues }: { status: "VALID" | "REVIEW" | "EXCLUDED" | null | undefined; issues?: { label: string; detail: string; severity: string }[] }) {
  if (!status || status === "VALID") return null;
  const relevant = (issues ?? []).filter((i) => i.severity !== "INFO");
  const why = relevant.map((i) => i.detail).join(" ");
  const label = status === "REVIEW" ? "Review required" : "Excluded from analytics";
  return (
    <span
      title={why || label}
      aria-label={`${label}${why ? `: ${why}` : ""}`}
      className={`${PILL} cursor-help ${
        status === "REVIEW" ? "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
      }`}
    >
      {status === "REVIEW" ? "⚠ " : ""}
      {relevant[0]?.label ?? label}
    </span>
  );
}

export interface MarketStatusProps {
  latestObservationDate: string | null;
  observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null;
  observationFreshness: "CURRENT" | "STALE" | "MISSING";
  quality: { status: "VALID" | "REVIEW" | "EXCLUDED"; issues: { label: string; detail: string; severity: string }[] } | null;
  carriedPrice: { cleanPrice: number | null; asOf: string } | null;
  noTradeRecordedSince: string | null;
}

/**
 * What the market last said about a security, in one cell: a dated trade
 * (with kind/freshness and any quality flag), "no trade since…" for a
 * security GFIM only carries a price for, or "no market quote".
 */
export function MarketStatusCell({ s, align = "right" }: { s: MarketStatusProps; align?: "left" | "right" }) {
  const justify = align === "right" ? "items-end" : "items-start";
  if (s.latestObservationDate) {
    return (
      <div className={`flex flex-col gap-0.5 ${justify}`}>
        <span className="text-xs text-zinc-700 dark:text-zinc-300">
          <span className="text-zinc-400 dark:text-zinc-500">{s.observationKind === "AUCTION_PRIMARY" ? "Auction " : "Traded "}</span>
          {formatIsoDate(s.latestObservationDate)}
        </span>
        <span className="flex flex-wrap gap-1">
          <ObservationKindBadge kind={s.observationKind} />
          <FreshnessBadge freshness={s.observationFreshness} />
          <QualityBadge status={s.quality?.status} issues={s.quality?.issues} />
        </span>
      </div>
    );
  }
  if (s.noTradeRecordedSince) {
    const tip = `GFIM keeps publishing ${s.carriedPrice?.cleanPrice != null ? `a closing price of ${s.carriedPrice.cleanPrice.toFixed(2)}` : "a closing price"}, but reports no trade in any daily report since at least ${formatIsoDate(s.noTradeRecordedSince)}. It is carried from an earlier, unknown date and is not used as a market price.`;
    return (
      <div className={`flex flex-col gap-0.5 ${justify}`} title={tip}>
        <span className="cursor-help text-xs text-zinc-500 dark:text-zinc-400">No trade since ≥ {formatIsoDate(s.noTradeRecordedSince)}</span>
        {s.carriedPrice?.cleanPrice != null && <span className="text-[10px] text-zinc-400 dark:text-zinc-500">carried price {s.carriedPrice.cleanPrice.toFixed(2)} · not a quote</span>}
      </div>
    );
  }
  return <span className="text-xs text-zinc-400 dark:text-zinc-500" title="Contractual terms are known, but no market price or yield has ever been observed.">No market quote</span>;
}

export function securityToMarketStatus(s: {
  latestObservationDate: string | null;
  analytics: { observationKind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null; quality: MarketStatusProps["quality"] };
  observationFreshness: "CURRENT" | "STALE" | "MISSING";
  carriedPrice: { cleanPrice: number | null; asOf: string } | null;
  noTradeRecordedSince: string | null;
}): MarketStatusProps {
  return {
    latestObservationDate: s.latestObservationDate,
    observationKind: s.analytics.observationKind,
    observationFreshness: s.observationFreshness,
    quality: s.analytics.quality,
    carriedPrice: s.carriedPrice,
    noTradeRecordedSince: s.noTradeRecordedSince,
  };
}

/** Terms-conflict marker next to a security's name — scenario returns rely on these terms too. */
export function TermsWarning({ issues }: { issues: { code: string; label: string; detail: string; severity: string }[] }) {
  const material = issues.filter((i) => i.severity !== "INFO");
  if (material.length === 0) return null;
  return (
    <span title={material.map((i) => i.detail).join(" ")} aria-label={material.map((i) => `${i.label}: ${i.detail}`).join(" ")} className={`${PILL} cursor-help bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300`}>
      ⚠ {material.map((i) => i.label).join(", ")}
    </span>
  );
}

const STATE_STYLE: Record<MarketState, string> = {
  RECENT: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  STALE: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  NEEDS_REVIEW: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  CARRIED_ONLY: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  NO_QUOTE: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

/** The one compact market-state badge (M7.3.2 §10): Recent · Stale · Needs review · Carried price — not a quote · No market quote. */
export function MarketStateChip({ state }: { state: MarketState }) {
  return <span className={`${PILL} ${STATE_STYLE[state]}`}>{state === "NEEDS_REVIEW" ? "⚠ " : ""}{MARKET_STATE_LABEL[state]}</span>;
}

const kindWord = (kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET") => (kind === "SECONDARY_MARKET" ? "secondary trade" : "primary auction");

/**
 * Benchmark context (M7.3.2 §8). The two things this UI must never blur:
 *   OBSERVED SPREAD   — the corporate actually traded; compared with a date-matched government observation.
 *   REFERENCE GoG YIELD — no reliable corporate observation; today's nearest-tenor government yield shown as
 *                         context for hypothetical scenarios ONLY. There is no spread.
 * `compact` fits a table cell; the full form is for cards and the security page.
 */
export function BenchmarkCell({ ctx, compact = true, align = "right" }: { ctx: BenchmarkContext; compact?: boolean; align?: "left" | "right" }) {
  const text = align === "right" ? "text-right" : "text-left";
  const tag = "text-[9px] font-semibold uppercase tracking-wide";
  switch (ctx.type) {
    case "SOVEREIGN":
      return <span className="text-xs text-zinc-400 dark:text-zinc-500">Sovereign benchmark</span>;
    case "OBSERVED_SPREAD":
      return (
        <div
          className={text}
          title={`${ctx.label} · ${kindWord(ctx.kind)} ${formatIsoDate(ctx.date)} · ${ctx.observationGapDays} days from this trade · tenor gap ${ctx.tenorGapDays} days${ctx.isWideGap ? " — wide gap, approximate" : ""}`}
        >
          <div className={`${tag} text-emerald-700 dark:text-emerald-400`}>Observed spread</div>
          <div className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatBps(ctx.spreadBps)}</div>
          <div className={`text-[10px] ${ctx.isWideGap ? "text-amber-600 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400"}`}>
            vs {compact ? "GoG" : ctx.label} at {formatPct(ctx.yieldPct)} · {formatIsoDate(ctx.date)}
            {ctx.isWideGap ? " · wide tenor gap" : ""}
          </div>
          {!compact && (
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {ctx.label} · {kindWord(ctx.kind)} · {ctx.observationGapDays}d from the trade · {ctx.tenorGapDays}d tenor gap
            </div>
          )}
        </div>
      );
    case "REFERENCE_ONLY":
      return (
        <div
          className={text}
          title={`No reliable market yield for this security, so there is NO observed spread. Today's nearest-tenor government yield (${ctx.label}, ${kindWord(ctx.kind)} ${formatIsoDate(ctx.date)}, tenor gap ${ctx.tenorGapDays} days) is context for hypothetical scenarios only.`}
        >
          <div className={`${tag} text-zinc-500 dark:text-zinc-400`}>Reference GoG yield</div>
          <div className="text-base font-medium tabular-nums text-zinc-700 dark:text-zinc-300">{formatPct(ctx.yieldPct)}</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400">nearest tenor · {formatIsoDate(ctx.date)}</div>
          <div className="text-[10px] italic text-zinc-400 dark:text-zinc-500">context for scenarios · no observed spread</div>
          {!compact && (
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {ctx.label} · {kindWord(ctx.kind)} · {ctx.tenorGapDays}d tenor gap{ctx.isWideGap ? " (wide)" : ""}
            </div>
          )}
        </div>
      );
    case "NO_DATE_MATCHED_BENCHMARK":
      return (
        <div className={text} title={`Suitable benchmark unavailable: no reliable Government of Ghana observation within ${BENCHMARK_DATE_WINDOW_DAYS} days of this trade, so no spread is shown.`}>
          <div className={`${tag} text-zinc-500 dark:text-zinc-400`}>Observed spread</div>
          <span className="cursor-help text-xs text-zinc-400 dark:text-zinc-500">No date-matched benchmark</span>
        </div>
      );
    case "UNAVAILABLE":
      return <Missing short="Unavailable" reason="No reliable market yield and no suitable government benchmark." />;
  }
}
