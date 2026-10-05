// ---------------------------------------------------------------------------
// Small presentational pieces shared by the portfolio surfaces (M8.1). No
// hooks, no calculation — only labelling of values the domain layer produced —
// so they work in server and client components alike.
// ---------------------------------------------------------------------------

import { RECENCY_LABEL, UNVALUED_LABEL, type InputRecency, type PortfolioAssetClass, type UnvaluedCode } from "@/lib/portfolio";

const PILL = "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap";

export function RecencyBadge({ recency }: { recency: InputRecency }) {
  return recency === "RECENT" ? (
    <span className={`${PILL} bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`} title={RECENCY_LABEL.RECENT}>
      Recent
    </span>
  ) : (
    <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`} title={RECENCY_LABEL.STALE}>
      Stale
    </span>
  );
}

export function UnvaluedBadge({ code }: { code: UnvaluedCode }) {
  return <span className={`${PILL} border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300`}>{UNVALUED_LABEL[code]}</span>;
}

export function AssetBadge({ assetClass, classification }: { assetClass: PortfolioAssetClass; classification?: "GOVERNMENT_BOND" | "CORPORATE_BOND" }) {
  if (assetClass === "EQUITY") return <span className={`${PILL} bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300`}>Equity</span>;
  return classification === "CORPORATE_BOND" ? (
    <span className={`${PILL} bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300`}>Corp bond</span>
  ) : (
    <span className={`${PILL} bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300`}>Gov bond</span>
  );
}

export function ageText(days: number): string {
  return days === 0 ? "today" : days === 1 ? "1 day old" : `${days} days old`;
}

export function formatPrice(value: number, decimals = 4): string {
  return value.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPctOf(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function formatInt(value: number): string {
  return value.toLocaleString("en-GB");
}
