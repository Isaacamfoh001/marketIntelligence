// Korbly-generated copy for evidence, catalysts and review (M9.2). System text — never a recommendation,
// a verdict on the thesis, a forecast, a score or an instruction to trade (tested). Analyst-authored
// text is shown as written and is never filtered.

export const EVIDENCE_HEADING = "Evidence";
export const EVIDENCE_INTRO = "What the analyst has attached to this thesis, and how they read it. Korbly records it; it does not weigh it.";
export const EVIDENCE_EMPTY = "No evidence has been added yet. Add an observation — from Korbly’s data or from your own research — and say whether it supports or challenges the thesis.";
export const EVIDENCE_NO_VERDICT = "Counts are not a verdict: evidence differs in relevance and meaning, and the analyst interprets it.";
export const RELEVANCE_NOTE = "Relevance is the analyst’s own label for how much an item matters to this thesis. It is not a probability or a measure of statistical strength.";
export const STANCE_NOTE = "Supports / challenges is the analyst’s reading, not a Korbly finding.";
export const KORBLY_LINK_NOTE = "Korbly data is frozen as it was when linked, so this record keeps its meaning even if the source later publishes a different figure.";
export const EXTERNAL_NOTE = "Analyst-linked source. Korbly has not opened it and does not verify its contents.";
export const ANALYST_OBSERVATION_NOTE = "Analyst observation — written by an analyst, with no outside source.";
export const OLDER_DATA_NOTE = "Older data when linked";
export const REVISED_NOTE = "The source has since published a different figure. This record still shows what was linked.";
export const CONTEXT_VS_EVIDENCE = "Current Korbly context is what Korbly knows now. It becomes evidence only when an analyst chooses to add it.";
export const ADD_TO_EVIDENCE = "Add to evidence";

export const REVIEW_HEADING = "Review suggested";
export const REVIEW_INTRO = "These are reasons to take another look. They are not a conclusion about the thesis, and the status and confidence are unchanged.";
export const REVIEW_NONE = "Nothing new needs a second look since the baseline below.";
export const REVIEWED_NOTE = "Marking a thesis reviewed records that you looked at it and its evidence as of now. It does not mean you agree with it, and nothing is deleted. A condition you have flagged stays flagged — and keeps asking for review — until you reset it.";
export const REVIEW_BASELINE_NEVER = "Never reviewed — counting from when the thesis was created.";

export const CATALYSTS_HEADING = "Catalysts";
export const CATALYSTS_INTRO = "Developments we are waiting for. Recording that one occurred records a fact; it does not say the thesis succeeded.";
export const CATALYSTS_EMPTY = "No catalysts tracked yet. Add what you are waiting for, with an expected month or quarter if you know one.";
export const WATCHING_VS_CATALYST = "Watch items are general indicators. Catalysts are specific developments with a status.";

export const FLAG_NOTE = "A flag is the analyst’s record. It never changes the thesis status — only the analyst does that.";
export const TIMELINE_HEADING = "Research timeline";
export const TIMELINE_INTRO = "What information arrived, by the date it applies to.";

export const RESEARCH_SYSTEM_COPY = [
  EVIDENCE_INTRO, EVIDENCE_EMPTY, EVIDENCE_NO_VERDICT, RELEVANCE_NOTE, STANCE_NOTE, KORBLY_LINK_NOTE, EXTERNAL_NOTE, ANALYST_OBSERVATION_NOTE, OLDER_DATA_NOTE, REVISED_NOTE, CONTEXT_VS_EVIDENCE,
  REVIEW_INTRO, REVIEW_NONE, REVIEWED_NOTE, REVIEW_BASELINE_NEVER, CATALYSTS_INTRO, CATALYSTS_EMPTY, WATCHING_VS_CATALYST, FLAG_NOTE, TIMELINE_INTRO,
] as const;
