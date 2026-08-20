// ---------------------------------------------------------------------------
// Shared directional-change semantics.
//
// Separates two independent concerns that were previously computed ad
// hoc (and inconsistently) at each call site:
//
//   direction  — what the number actually did (up/down/flat). Purely
//                arithmetic; must always agree with the numeric sign.
//   sentiment  — what that movement MEANS for this specific metric.
//                A rising GSE index and a rising USD/GHS rate are both
//                "up", but one is good news and the other is the cedi
//                weakening — they must not share a color by accident.
//
// `polarity` is the only thing a caller has to get right per metric:
//   higherIsPositive — e.g. an equity index
//   higherIsNegative — e.g. inflation, USD/GHS (rising = cedi weaker)
//   neutral          — e.g. Treasury yields, the policy rate: a "higher
//                      is good/bad" framing would be presented as
//                      investment advice, which this product must not do
// ---------------------------------------------------------------------------

export type Direction = "up" | "down" | "flat";
export type Sentiment = "positive" | "negative" | "neutral";
export type Polarity = "higherIsPositive" | "higherIsNegative" | "neutral";

export interface DirectionInfo {
  direction: Direction;
  sentiment: Sentiment;
  arrow: string;
}

export const DIRECTION_ARROW: Record<Direction, string> = { up: "▲", down: "▼", flat: "—" };

/** Single source of truth for sentiment color — reused by DirectionText and any custom-styled value that needs the same mapping. */
export const SENTIMENT_TEXT_CLASS: Record<Sentiment, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-zinc-500 dark:text-zinc-400",
};

/** Direction is pure arithmetic — never inferred from anything else. */
export function computeDirection(current: number, prior: number, epsilon: number = 0): Direction {
  const diff = current - prior;
  if (Math.abs(diff) <= epsilon) return "flat";
  return diff > 0 ? "up" : "down";
}

export function sentimentFor(direction: Direction, polarity: Polarity): Sentiment {
  if (direction === "flat" || polarity === "neutral") return "neutral";
  if (polarity === "higherIsPositive") return direction === "up" ? "positive" : "negative";
  return direction === "up" ? "negative" : "positive"; // higherIsNegative
}

export function describeDirection(current: number, prior: number, polarity: Polarity, epsilon: number = 0): DirectionInfo {
  const direction = computeDirection(current, prior, epsilon);
  return { direction, sentiment: sentimentFor(direction, polarity), arrow: DIRECTION_ARROW[direction] };
}
