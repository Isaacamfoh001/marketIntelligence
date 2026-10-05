// Korbly-generated copy for the thesis workspace. This wording is system text, not analyst
// text, and must never read as a recommendation, a forecast, a score or a verdict on the thesis
// (tested). Analyst-authored thesis text is displayed as written and is never filtered.

export const THESIS_PAGE_INTRO = "Capture the investment reasoning behind a security so the team can track what must be true, what could challenge the view, and what to watch.";
export const THESIS_LIBRARY_EMPTY = THESIS_PAGE_INTRO;
export const THESIS_FILTER_EMPTY = "No theses match these filters.";
export const HOLDING_NO_THESIS = "No thesis yet";

export const AUTHORSHIP_NOTE = "Written by an analyst. Korbly does not generate, score or verify this reasoning.";
export const CONTEXT_HEADING = "Current Korbly context";
export const CONTEXT_NOTE = "Market and portfolio data as Korbly holds it now. It sits beside the thesis for reference; it does not confirm or refute it.";
export const CONFIDENCE_NOTE = "Analyst-declared confidence — not a probability, not a model output, and not a measure of data quality.";
export const SCENARIO_NOTE = "Scenario Studio shows what a portfolio would do under assumptions you choose. It is a calculation, not a forecast, and it is not built from this thesis’s text.";
export const NOT_HELD_NOTE = "Not currently held in any portfolio. A thesis does not require a holding.";
export const ASSUMPTION_CONTEXT_NOTE = "A valuation assumption is an analyst input about where this holding starts. It is not a market observation and is separate from this thesis.";
export const STALE_CONTEXT_NOTE = "Informational only — older data does not change the thesis status.";
export const STATUS_ANALYST_NOTE = "Status is set by the analyst. Korbly never changes it automatically.";
export const CHALLENGED_MEANING = "The thesis may still hold, but something important needs a second look.";
export const INVALIDATED_VS_CLOSED = "Invalidated = the reasoning no longer holds. Closed = no longer tracked, for any reason.";

/** Prompts that invite disciplined, falsifiable thinking. Placeholders, never prefilled content. */
export const PROMPTS = {
  belief: "What do we believe will prove true about this investment?",
  rationale: "Why do we believe it? What is the reasoning?",
  mustBeTrue: "One condition per line — what has to hold for the thesis to work?",
  invalidation: "One per line, completing: “We should reconsider if…”",
  risks: "One per line — what could weaken the case?",
  catalysts: "One per line — what could make the view play out or become visible?",
  watching: "One per line — indicators, releases or events to keep an eye on.",
} as const;
