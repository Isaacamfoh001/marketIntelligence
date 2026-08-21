// ---------------------------------------------------------------------------
// Deterministic financial-statement text extraction helpers (M7.1 §9-26).
//
// Operates on TEXT already pulled from an official statement (a PDF read
// via the Read tool, or any other text source) — this module does no PDF
// binary parsing itself. It exists to turn "a line of statement text" into
// a validated candidate row the existing importCompanyFinancials pipeline
// can accept, with the specific deterministic checks financial-statement
// extraction needs and generic CSV import doesn't:
//
//   - number tokens: parentheses-negative, thousands commas, a bare dash
//     as MISSING (never 0) — §22
//   - unit-hint detection from surrounding text (GH¢'000, GHS million,
//     pesewas) — §21/§23
//   - the current-vs-comparative-year column problem — §20, flagged as
//     the highest-risk extraction error in the brief
//
// No LLM is the numerical parser here: every function below is a plain
// deterministic string/regex transform, and every candidate still passes
// through validateFinancialRows (financials-parser.ts) before persistence
// — the same gate manual CSV rows go through. This module only produces
// candidates; a human (or the CLI/UI review step) decides what to import.
// ---------------------------------------------------------------------------

export type ExtractionConfidence = "HIGH_CONFIDENCE" | "REVIEW_REQUIRED" | "REJECTED";

export interface ExtractionCandidate {
  reportedLabel: string;
  reportedValue: string | null; // signed decimal string, or null if genuinely missing (a dash)
  reportedUnit: string | null; // raw unit hint text, e.g. "GH¢'000" — not yet mapped to a MetricUnit code
  confidence: ExtractionConfidence;
  reasons: string[]; // why this confidence level, always populated (never a meaningless bare score)
}

// ---------------------------------------------------------------------------
// Number token parsing
// ---------------------------------------------------------------------------

const DASH_TOKENS = new Set(["-", "—", "–", "n/a", "na", "nil"]);

/**
 * Parses one statement number cell. Distinguishes three outcomes:
 *   - a real number (including negative-via-parentheses)
 *   - MISSING (a bare dash/"n/a" — CLAUDE.md: never coerced to 0)
 *   - unparsable (garbage text — caller should reject, not guess)
 * Returns `undefined` (not null) for unparsable input, so callers can
 * tell "explicitly missing" apart from "couldn't be read at all".
 */
export function parseStatementNumber(raw: string): string | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;

  const normalized = trimmed.toLowerCase();
  if (DASH_TOKENS.has(normalized)) return null; // missing, not zero

  let working = trimmed;
  let negative = false;

  // Parenthesized figures are negative in financial-statement convention.
  const parenMatch = /^\(([^)]+)\)$/.exec(working);
  if (parenMatch) {
    negative = true;
    working = parenMatch[1];
  } else if (working.startsWith("-")) {
    negative = true;
    working = working.slice(1);
  }

  // Reject anything containing letters outright — "see note 14" must
  // never be read as the number 14. Only currency symbols/punctuation
  // are allowed alongside digits before stripping.
  if (/[a-zA-Z]/.test(working)) return undefined;

  // Strip thousands separators and any stray currency/space characters,
  // keeping only digits and a single decimal point.
  const cleaned = working.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return undefined;

  return negative ? `-${cleaned}` : cleaned;
}

// ---------------------------------------------------------------------------
// Unit-hint detection
// ---------------------------------------------------------------------------

export type DetectedScale = "GHS" | "GHS_THOUSANDS" | "GHS_MILLIONS" | "PESEWAS";

const SCALE_HINTS: [RegExp, DetectedScale][] = [
  [/gh[c¢s]?\s*'?000|thousand/i, "GHS_THOUSANDS"],
  [/gh[c¢s]?\s*million|million/i, "GHS_MILLIONS"],
  [/pesewa|\bgp\b/i, "PESEWAS"],
  [/gh[c¢s]/i, "GHS"],
];

/** Scans free text (a statement header, a column caption, a note) for a reporting-scale hint. Returns null if none of the known patterns match — caller must not guess a default. */
export function detectScale(text: string): DetectedScale | null {
  for (const [pattern, scale] of SCALE_HINTS) {
    if (pattern.test(text)) return scale;
  }
  return null;
}

/** Pesewas are a SUB-unit of GHS (1 GHS = 100 pesewas) — the only detected scale that divides rather than multiplies. Used only for per-share figures (§23); money-statement scales use unitScaleFactor in financial-metrics.ts instead. */
export function convertPesewasToGhs(value: string): string {
  return (Number(value) / 100).toString();
}

// ---------------------------------------------------------------------------
// Current vs comparative-year column disambiguation (§20 — the highest-
// risk extraction error named in the brief).
// ---------------------------------------------------------------------------

const YEAR_RE = /\b(20\d{2})\b/g;

/** Extracts every 4-digit year appearing in a header line, in left-to-right order — e.g. "Note  2025  2024" -> [2025, 2024]. */
export function parseColumnYears(headerLine: string): number[] {
  return Array.from(headerLine.matchAll(YEAR_RE)).map((m) => Number(m[1]));
}

/**
 * Given a header's column years (current-year-first, as GSE/Ghanaian
 * statements conventionally print) and a data row's cell values in the
 * same left-to-right order, returns the value belonging to `targetYear`
 * specifically — never "whichever column comes first" (§20's exact
 * failure mode: silently importing the FY2024 comparative as if it were
 * FY2025). Returns null if `targetYear` doesn't appear in the header at
 * all, rather than guessing a position.
 */
export function selectColumnForYear(columnYears: number[], rowValues: string[], targetYear: number): string | null {
  const index = columnYears.indexOf(targetYear);
  if (index === -1 || index >= rowValues.length) return null;
  return rowValues[index];
}

// ---------------------------------------------------------------------------
// Candidate construction with confidence classification (§19)
// ---------------------------------------------------------------------------

import { resolveMetricCode } from "../financial-metrics";

export function buildExtractionCandidate(params: {
  reportedLabel: string;
  columnYears: number[];
  rowValues: string[];
  targetYear: number;
  unitHintText: string;
}): ExtractionCandidate {
  // Structural failures: there is no candidate value to review at all —
  // always REJECTED, never left for a human to "review" a number that
  // doesn't exist.
  const rawCell = selectColumnForYear(params.columnYears, params.rowValues, params.targetYear);
  if (rawCell === null) {
    return {
      reportedLabel: params.reportedLabel,
      reportedValue: null,
      reportedUnit: null,
      confidence: "REJECTED",
      reasons: [`target year ${params.targetYear} not found in column headers [${params.columnYears.join(", ")}]`],
    };
  }

  const parsed = parseStatementNumber(rawCell);
  if (parsed === undefined) {
    return {
      reportedLabel: params.reportedLabel,
      reportedValue: null,
      reportedUnit: null,
      confidence: "REJECTED",
      reasons: [`cell "${rawCell}" could not be parsed as a number`],
    };
  }
  if (parsed === null) {
    return {
      reportedLabel: params.reportedLabel,
      reportedValue: null,
      reportedUnit: null,
      confidence: "REJECTED",
      reasons: ["value is a dash (not published) — nothing to import"],
    };
  }

  // A real number exists. Anything from here on is "how much do we trust
  // the surrounding context" — never grounds to invent the number itself.
  const reasons: string[] = [];
  const metricCode = resolveMetricCode(params.reportedLabel);
  if (!metricCode) reasons.push(`label "${params.reportedLabel}" did not match a known metric alias — needs a human to map it or add an alias`);

  const scale = detectScale(params.unitHintText);
  if (!scale) reasons.push(`no unit hint recognised in "${params.unitHintText}" — needs a human to confirm the reporting scale`);

  const confidence: ExtractionConfidence = reasons.length === 0 ? "HIGH_CONFIDENCE" : "REVIEW_REQUIRED";

  return {
    reportedLabel: params.reportedLabel,
    reportedValue: parsed,
    reportedUnit: scale,
    confidence,
    reasons: reasons.length > 0 ? reasons : ["label, year column, and unit all matched unambiguously"],
  };
}
