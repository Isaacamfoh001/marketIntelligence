import Link from "next/link";
import { CompanyLogo } from "./CompanyLogo";
import type { CompanyHighlight, CompanyHighlights as CompanyHighlightsData } from "@/lib/queries/companies";

/**
 * Compact, deterministic cross-company leaders (M8 §35). Purely computed
 * context — never commentary — and a slot with no comparable candidates
 * says so rather than showing a stale/misleading leader (M8 §35-36).
 */
function HighlightSlot({ label, highlight, suffix }: { label: string; highlight: CompanyHighlight | null; suffix: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      {highlight ? (
        <Link href={`/companies/${highlight.ticker}`} className="mt-2 flex items-center gap-2 hover:underline">
          <CompanyLogo ticker={highlight.ticker} size={24} />
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{highlight.ticker}</div>
            <div className="text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
              {highlight.value >= 0 ? "+" : ""}
              {highlight.value.toFixed(1)}
              {suffix}
            </div>
          </div>
        </Link>
      ) : (
        <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">No comparable companies yet</p>
      )}
    </div>
  );
}

export function CompanyHighlightsSection({ highlights }: { highlights: CompanyHighlightsData }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <HighlightSlot label="Highest Revenue Growth" highlight={highlights.highestRevenueGrowth} suffix="%" />
      <HighlightSlot label="Strongest PAT Growth" highlight={highlights.strongestPatGrowth} suffix="%" />
      <HighlightSlot label="Highest ROE" highlight={highlights.highestRoe} suffix="%" />
      <HighlightSlot label="Highest Dividend Yield" highlight={highlights.highestDividendYield} suffix="%" />
    </div>
  );
}
