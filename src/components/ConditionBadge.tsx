import { SENTIMENT_TEXT_CLASS } from "@/lib/direction";
import type { IntelligenceResult } from "@/lib/intelligence";

/**
 * A compact condition label for a section heading (M8 §33 — "modest"
 * Macro & Rates enhancement, not a page redesign). Reuses the same
 * IntelligenceResult every other M8 surface renders, so a badge here
 * always agrees with Overview's Market Condition card for the same data.
 */
export function ConditionBadge({ result }: { result: IntelligenceResult<string> }) {
  const unavailable = result.freshness !== "CURRENT";
  return (
    <span
      title={result.explanation}
      className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal ${
        unavailable ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500" : "bg-zinc-100 dark:bg-zinc-800"
      } ${unavailable ? "" : SENTIMENT_TEXT_CLASS[result.sentiment]}`}
    >
      {result.headline}
    </span>
  );
}
