import { SENTIMENT_TEXT_CLASS, type Sentiment } from "@/lib/direction";

/**
 * Renders a directional change consistently everywhere it appears
 * (Key Indicators, What Changed?, Macro & Rates, future Equities): an
 * arrow, the magnitude text, and — since color alone must never carry
 * the meaning — an optional semantic label, all colored by sentiment.
 * `suffix` is always muted regardless of sentiment, for contextual text
 * ("vs previous auction") that isn't itself part of the change.
 */
export function DirectionText({
  arrow,
  text,
  label,
  suffix,
  sentiment,
}: {
  arrow: string;
  text: string;
  label?: string;
  suffix?: string;
  sentiment: Sentiment;
}) {
  return (
    <span>
      <span className={SENTIMENT_TEXT_CLASS[sentiment]}>
        {arrow} {text}
        {label ? ` · ${label}` : ""}
      </span>
      {suffix ? <span className="text-zinc-400 dark:text-zinc-500"> {suffix}</span> : null}
    </span>
  );
}
