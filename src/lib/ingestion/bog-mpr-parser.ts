// ---------------------------------------------------------------------------
// Bank of Ghana Monetary Policy Rate parsing.
//
// Two official HTML sources, combined:
//
//  1. Policy Rate Trends page's "Historical Policy Rate Decisions" table
//     (https://www.bog.gov.gh/monetary-policy/policy-rate-trends/) —
//     [Meeting No., MPC Dates, Effective Date, BOG Policy Rate]. Fully
//     server-rendered, no AJAX. This table already includes HOLD
//     meetings as consecutive equal-value rows for most of its history —
//     but at time of writing it lags the two most recent meetings
//     (20 May 2026, 20-22 Jul 2026), which BoG simply hasn't added rows
//     for yet.
//
//  2. MPC Press Release archive (any page under
//     https://www.bog.gov.gh/mpc_press_release/) — a dated list of every
//     press release BoG has published, confirming a meeting occurred on
//     a given date even before the Policy Rate Trends table catches up.
//     Does not state the resulting rate (that's only in the linked PDF,
//     which is deliberately not parsed here — see provider file header).
//
// computeDecisionsFromRateHistory() turns (1) into a full decision
// history with HIKE/CUT/HOLD computed from consecutive rate comparisons.
// deriveHoldDecisionsFromMeetings() fills the gap using (2): any archive
// meeting date after the table's latest entry, with no table row of its
// own, is inferred as a HOLD at the carried-forward rate — a definition,
// not a guess (a hold means the rate to still be the previous rate).
// ---------------------------------------------------------------------------

import * as cheerio from "cheerio";
import { parseDecimal } from "../validation/index";
import { parseBogDate, parseBogLongDate } from "./bog-date";

// ---------------------------------------------------------------------------
// Historical Policy Rate Decisions table
// ---------------------------------------------------------------------------

export interface RawMprRow {
  meetingNumber: string;
  mpcDates: string;
  effectiveDateText: string;
  rateText: string;
}

export interface NormalisedMprRow {
  effectiveDate: Date;
  rate: string;
}

/**
 * Extract MPR decision rows from the Policy Rate Trends page's
 * server-rendered HTML. Scans every table row for the 4-cell
 * [meeting no., MPC dates, effective date, rate] shape, identified by
 * the 3rd cell looking like a BoG "DD MMM YYYY" date.
 */
export function extractRowsFromHtml(html: string): RawMprRow[] {
  const $ = cheerio.load(html);
  const rows: RawMprRow[] = [];

  $("table tbody tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();

    if (cells.length !== 4) return;
    const [meetingNumber, mpcDates, effectiveDateText, rateText] = cells;
    if (!/^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(effectiveDateText)) return;

    rows.push({ meetingNumber, mpcDates, effectiveDateText, rateText });
  });

  return rows;
}

export interface MprValidationResult {
  valid: NormalisedMprRow[];
  invalid: { row: RawMprRow; errors: string[] }[];
}

/** Broad sanity bound only — a policy rate of 0–100% covers any regime BoG has run. */
export function validateMprRows(rows: RawMprRow[]): MprValidationResult {
  const valid: NormalisedMprRow[] = [];
  const invalid: { row: RawMprRow; errors: string[] }[] = [];

  for (const row of rows) {
    const errors: string[] = [];

    const parsedDate = parseBogDate(row.effectiveDateText, "effective_date");
    if (parsedDate.error) errors.push(parsedDate.error.message);

    const rate = parseDecimal(row.rateText, "rate");
    if (rate.error) errors.push(rate.error.message);
    else if (Number(rate.value) < 0 || Number(rate.value) > 100) {
      errors.push(`rate is outside a plausible policy-rate range: "${row.rateText}"`);
    }

    if (errors.length > 0) {
      invalid.push({ row, errors });
      continue;
    }

    valid.push({ effectiveDate: parsedDate.date!, rate: rate.value! });
  }

  return { valid, invalid };
}

// ---------------------------------------------------------------------------
// Decision derivation
// ---------------------------------------------------------------------------

export type DecisionType = "HIKE" | "CUT" | "HOLD";

export interface DerivedDecision {
  decisionDate: Date;
  resultingRate: string;
  decisionType: DecisionType;
  changeBps: number | null;
}

/**
 * Computes HIKE/CUT/HOLD and the basis-point change for every row,
 * comparing each decision's rate to the immediately preceding one in
 * time. The first decision on record has no predecessor to compare
 * against, so it's recorded as HOLD with changeBps null (not 0 — 0 would
 * falsely claim a comparison was made and found no change).
 */
export function computeDecisionsFromRateHistory(rows: NormalisedMprRow[]): DerivedDecision[] {
  const sorted = [...rows].sort((a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime());
  const decisions: DerivedDecision[] = [];
  let prevRate: number | null = null;

  for (const row of sorted) {
    const rate = Number(row.rate);
    let decisionType: DecisionType;
    let changeBps: number | null;

    if (prevRate === null) {
      decisionType = "HOLD";
      changeBps = null;
    } else {
      changeBps = Math.round((rate - prevRate) * 100);
      decisionType = changeBps > 0 ? "HIKE" : changeBps < 0 ? "CUT" : "HOLD";
    }

    decisions.push({ decisionDate: row.effectiveDate, resultingRate: row.rate, decisionType, changeBps });
    prevRate = rate;
  }

  return decisions;
}

// ---------------------------------------------------------------------------
// MPC Press Release archive (meeting-date confirmation only)
// ---------------------------------------------------------------------------

export interface RawArchiveEntry {
  dateText: string;
  title: string;
}

/**
 * Extracts (date, title) pairs from the MPC Press Release archive
 * widget present on any page under /mpc_press_release/. Structural
 * selector (the Jet Elementor listing-grid item), not tied to page copy.
 */
export function extractArchiveEntries(html: string): RawArchiveEntry[] {
  const $ = cheerio.load(html);
  const entries: RawArchiveEntry[] = [];

  $(".jet-listing-grid__item").each((_, item) => {
    const dateText = $(item).find(".elementor-button-text").first().text().trim();
    const title = $(item).find("h2.elementor-heading-title a").first().text().trim();
    if (dateText && title) entries.push({ dateText, title });
  });

  return entries;
}

export interface MeetingDate {
  date: Date;
  title: string;
}

const DECISION_TITLE_RE = /^(Emergency\s+)?MPC Press Release/i;

export interface ArchiveValidationResult {
  valid: MeetingDate[];
  invalid: { row: RawArchiveEntry; errors: string[] }[];
}

/**
 * Validates archive entries. Entries whose title doesn't match the MPC
 * decision press-release pattern (e.g. "Transcript – 124th MPC Press
 * Briefing") are silently excluded — they're real archive items, just
 * not decision announcements, not malformed data.
 */
export function validateArchiveEntries(entries: RawArchiveEntry[]): ArchiveValidationResult {
  const valid: MeetingDate[] = [];
  const invalid: { row: RawArchiveEntry; errors: string[] }[] = [];

  for (const entry of entries) {
    if (!DECISION_TITLE_RE.test(entry.title)) continue;

    const parsed = parseBogLongDate(entry.dateText, "meeting_date");
    if (parsed.error) {
      invalid.push({ row: entry, errors: [parsed.error.message] });
      continue;
    }
    valid.push({ date: parsed.date, title: entry.title });
  }

  return { valid, invalid };
}

/**
 * Fills the gap between the rate-history table's latest known decision
 * and any later confirmed meeting dates from the press-release archive,
 * inferring HOLD at the carried-forward rate for each. Not a guess: a
 * HOLD decision is defined as "the rate stayed the same," so the
 * resulting rate for a gap meeting is deterministic given the table's
 * latest known rate.
 */
export function deriveHoldDecisionsFromMeetings(
  meetings: MeetingDate[],
  knownDecisions: DerivedDecision[],
): DerivedDecision[] {
  if (knownDecisions.length === 0) return [];

  const latestKnown = knownDecisions.reduce((a, b) => (b.decisionDate > a.decisionDate ? b : a));
  const knownDates = new Set(knownDecisions.map((d) => d.decisionDate.toISOString().slice(0, 10)));

  return meetings
    .filter((m) => m.date > latestKnown.decisionDate && !knownDates.has(m.date.toISOString().slice(0, 10)))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((m) => ({
      decisionDate: m.date,
      resultingRate: latestKnown.resultingRate,
      decisionType: "HOLD" as const,
      changeBps: 0,
    }));
}
