import { describe, it, expect } from "vitest";
import {
  extractRowsFromHtml,
  validateMprRows,
  computeDecisionsFromRateHistory,
  extractArchiveEntries,
  validateArchiveEntries,
  deriveHoldDecisionsFromMeetings,
  type RawMprRow,
  type NormalisedMprRow,
  type DerivedDecision,
} from "../ingestion/bog-mpr-parser";

function htmlTable(rows: string[][]): string {
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

describe("extractRowsFromHtml", () => {
  it("parses a valid MPC decision row", () => {
    const html = htmlTable([["129", "March 16 – 18, 2026", "18 Mar 2026", "14.0"]]);
    const rows = extractRowsFromHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      meetingNumber: "129",
      mpcDates: "March 16 – 18, 2026",
      effectiveDateText: "18 Mar 2026",
      rateText: "14.0",
    });
  });

  it("ignores rows that don't have a BoG-date-shaped 3rd cell", () => {
    const html = htmlTable([["129", "March 16 – 18, 2026", "not-a-date", "14.0"]]);
    expect(extractRowsFromHtml(html)).toHaveLength(0);
  });

  it("ignores rows with the wrong cell count", () => {
    const html = htmlTable([["129", "18 Mar 2026", "14.0"]]); // only 3 cells
    expect(extractRowsFromHtml(html)).toHaveLength(0);
  });
});

function row(overrides: Partial<RawMprRow>): RawMprRow {
  return { meetingNumber: "129", mpcDates: "March 16 – 18, 2026", effectiveDateText: "18 Mar 2026", rateText: "14.0", ...overrides };
}

describe("validateMprRows", () => {
  it("accepts a well-formed decision, preserving the effective date", () => {
    const result = validateMprRows([row({})]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].rate).toBe("14.0");
    expect(result.valid[0].effectiveDate.toISOString().slice(0, 10)).toBe("2026-03-18");
  });

  it("rejects a malformed effective date", () => {
    const result = validateMprRows([row({ effectiveDateText: "31 Feb 2026" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("effective_date"))).toBe(true);
  });

  it("rejects a malformed rate", () => {
    const result = validateMprRows([row({ rateText: "N/A" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("rate"))).toBe(true);
  });

  it("rejects an implausible rate outside 0-100%", () => {
    const result = validateMprRows([row({ rateText: "150" })]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid[0].errors.some((e) => e.includes("plausible"))).toBe(true);
  });
});

function normRow(effectiveDate: string, rate: string): NormalisedMprRow {
  return { effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`), rate };
}

describe("computeDecisionsFromRateHistory", () => {
  it("marks the first decision on record as HOLD with a null bps change", () => {
    const decisions = computeDecisionsFromRateHistory([normRow("2002-11-21", "25.5")]);
    expect(decisions).toEqual([
      { decisionDate: new Date("2002-11-21T00:00:00.000Z"), resultingRate: "25.5", decisionType: "HOLD", changeBps: null },
    ]);
  });

  it("classifies a rate decrease as CUT with negative bps", () => {
    const decisions = computeDecisionsFromRateHistory([normRow("2026-01-28", "15.5"), normRow("2026-03-18", "14.0")]);
    expect(decisions[1]).toMatchObject({ decisionType: "CUT", changeBps: -150 });
  });

  it("classifies a rate increase as HIKE with positive bps", () => {
    const decisions = computeDecisionsFromRateHistory([normRow("2025-01-01", "20.0"), normRow("2025-02-01", "21.5")]);
    expect(decisions[1]).toMatchObject({ decisionType: "HIKE", changeBps: 150 });
  });

  it("classifies an unchanged rate as HOLD with zero bps", () => {
    const decisions = computeDecisionsFromRateHistory([normRow("2026-03-18", "14.0"), normRow("2026-05-20", "14.0")]);
    expect(decisions[1]).toMatchObject({ decisionType: "HOLD", changeBps: 0 });
  });

  it("sorts out-of-order input chronologically before comparing", () => {
    const decisions = computeDecisionsFromRateHistory([normRow("2026-03-18", "14.0"), normRow("2026-01-28", "15.5")]);
    expect(decisions.map((d) => d.decisionDate.toISOString().slice(0, 10))).toEqual(["2026-01-28", "2026-03-18"]);
    expect(decisions[1]).toMatchObject({ decisionType: "CUT", changeBps: -150 });
  });
});

describe("extractArchiveEntries", () => {
  it("parses the MPC press release archive listing", () => {
    const html = `
      <div class="jet-listing-grid__item">
        <span class="elementor-button-text">July 22, 2026</span>
        <h2 class="elementor-heading-title"><a href="#">MPC Press Release – July 2026</a></h2>
      </div>
      <div class="jet-listing-grid__item">
        <span class="elementor-button-text">June 18, 2025</span>
        <h2 class="elementor-heading-title"><a href="#">Transcript – 124th MPC Press Briefing</a></h2>
      </div>
    `;
    const entries = extractArchiveEntries(html);
    expect(entries).toEqual([
      { dateText: "July 22, 2026", title: "MPC Press Release – July 2026" },
      { dateText: "June 18, 2025", title: "Transcript – 124th MPC Press Briefing" },
    ]);
  });
});

describe("validateArchiveEntries", () => {
  it("accepts a regular MPC Press Release entry", () => {
    const result = validateArchiveEntries([{ dateText: "July 22, 2026", title: "MPC Press Release – July 2026" }]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].date.toISOString().slice(0, 10)).toBe("2026-07-22");
  });

  it("accepts an Emergency MPC Press Release entry", () => {
    const result = validateArchiveEntries([{ dateText: "July 18, 2025", title: "Emergency MPC Press Release – July 2025" }]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].date.toISOString().slice(0, 10)).toBe("2025-07-18");
  });

  it("silently excludes non-decision entries like transcripts, without treating them as errors", () => {
    const result = validateArchiveEntries([{ dateText: "June 18, 2025", title: "Transcript – 124th MPC Press Briefing" }]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(0);
  });

  it("flags a decision-titled entry with an unparseable date as invalid", () => {
    const result = validateArchiveEntries([{ dateText: "not a date", title: "MPC Press Release – July 2026" }]);
    expect(result.valid).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
  });
});

function decision(overrides: Partial<DerivedDecision>): DerivedDecision {
  return { decisionDate: new Date("2026-03-18T00:00:00.000Z"), resultingRate: "14.0", decisionType: "CUT", changeBps: -150, ...overrides };
}

describe("deriveHoldDecisionsFromMeetings", () => {
  it("infers HOLD at the carried-forward rate for meetings after the latest known decision", () => {
    const known = [decision({})];
    const meetings = [
      { date: new Date("2026-05-20T00:00:00.000Z"), title: "MPC Press Release – May 2026" },
      { date: new Date("2026-07-22T00:00:00.000Z"), title: "MPC Press Release – July 2026" },
    ];
    const holds = deriveHoldDecisionsFromMeetings(meetings, known);
    expect(holds).toEqual([
      { decisionDate: new Date("2026-05-20T00:00:00.000Z"), resultingRate: "14.0", decisionType: "HOLD", changeBps: 0 },
      { decisionDate: new Date("2026-07-22T00:00:00.000Z"), resultingRate: "14.0", decisionType: "HOLD", changeBps: 0 },
    ]);
  });

  it("does not re-derive a meeting date already present in known decisions", () => {
    const known = [decision({}), decision({ decisionDate: new Date("2026-05-20T00:00:00.000Z"), decisionType: "HOLD", changeBps: 0 })];
    const meetings = [{ date: new Date("2026-05-20T00:00:00.000Z"), title: "MPC Press Release – May 2026" }];
    expect(deriveHoldDecisionsFromMeetings(meetings, known)).toHaveLength(0);
  });

  it("ignores meetings at or before the latest known decision date", () => {
    const known = [decision({})]; // latest known = 2026-03-18
    const meetings = [{ date: new Date("2026-01-28T00:00:00.000Z"), title: "MPC Press Release – January 2026" }];
    expect(deriveHoldDecisionsFromMeetings(meetings, known)).toHaveLength(0);
  });

  it("returns nothing when there are no known decisions to anchor against", () => {
    const meetings = [{ date: new Date("2026-07-22T00:00:00.000Z"), title: "MPC Press Release – July 2026" }];
    expect(deriveHoldDecisionsFromMeetings(meetings, [])).toHaveLength(0);
  });
});
