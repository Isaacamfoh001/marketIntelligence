// ---------------------------------------------------------------------------
// Integration tests for the Bank of Ghana Monetary Policy Rate ingestion —
// the two-source (rate table + press-release archive) HOLD-derivation
// pipeline added to correct MPC presentation after the rate table lagged
// the May/July 2026 "held" decisions.
//
// Real database, mocked HTTP. Synthetic decisions use dates in 2099 so
// cleanup can target exactly what these tests create. Every IngestionRun
// created is tracked and deleted in afterAll — ingestBogMpr upserts
// against the same two DataSources live ingestion uses.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/http", () => ({
  fetchBogText: vi.fn(),
  postBogForm: vi.fn(),
}));

import { fetchBogText } from "../ingestion/http";
import { ingestBogMpr } from "../ingestion/bog-mpr-provider";

const db = getPrisma();
const mockFetch = vi.mocked(fetchBogText);

const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");
const createdRunIds: string[] = [];

async function trackedIngest() {
  const result = await ingestBogMpr();
  createdRunIds.push(result.rateTableRun.runId, result.archiveRun.runId);
  return result;
}

const MPR_URL = "https://www.bog.gov.gh/monetary-policy/policy-rate-trends/";
const ARCHIVE_URL = "https://www.bog.gov.gh/mpc_press_release/";

function rateTableHtml(rows: [string, string][]): string {
  // [effectiveDateText, rateText][]
  const body = rows
    .map(([date, rate], i) => `<tr><td>${i + 1}</td><td>Meeting ${i + 1}</td><td>${date}</td><td>${rate}</td></tr>`)
    .join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

function archiveHtml(entries: [string, string][]): string {
  // [dateText, title][]
  const items = entries
    .map(
      ([date, title]) => `
        <div class="jet-listing-grid__item">
          <span class="elementor-button-text">${date}</span>
          <h2 class="elementor-heading-title"><a href="#">${title}</a></h2>
        </div>`,
    )
    .join("\n");
  return `<html><body>${items}</body></html>`;
}

function mockUrls(rateHtml: string, archiveHtmlContent: string) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url === MPR_URL) return rateHtml;
    if (url === ARCHIVE_URL) return archiveHtmlContent;
    throw new Error(`unexpected URL in test: ${url}`);
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

// deriveHoldDecisionsFromMeetings anchors against the GLOBAL latest
// PolicyDecision row (by design — see provider file header on
// self-healing). Tests share a database, so a synthetic row left behind
// by one test would silently shift another test's anchor. Wipe synthetic
// rows after every test, not just at the end, so each test's HOLD
// derivation is judged only against what it itself inserted.
afterEach(async () => {
  await db.policyDecision.deleteMany({ where: { decisionDate: { gte: SYNTHETIC_FLOOR } } });
});

afterAll(async () => {
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestBogMpr — rate table", () => {
  it("computes CUT with the correct bps for a rate decrease", async () => {
    mockUrls(rateTableHtml([["01 Jan 2099", "20.0"], ["01 Mar 2099", "18.5"]]), archiveHtml([]));

    const result = await trackedIngest();

    expect(result.rateTableRun.status).toBe("SUCCESS");
    expect(result.currentRate).toBe("18.5");
    expect(result.lastChangeType).toBe("CUT");
    expect(result.lastChangeBps).toBe(-150);

    const stored = await db.policyDecision.findFirstOrThrow({ where: { decisionDate: new Date("2099-03-01T00:00:00.000Z") } });
    expect(stored.decisionType).toBe("CUT");
    expect(stored.changeBps).toBe(-150);
  });

  it("computes HIKE with the correct bps for a rate increase", async () => {
    mockUrls(rateTableHtml([["05 Jan 2099", "10.0"], ["05 Mar 2099", "11.75"]]), archiveHtml([]));

    const result = await trackedIngest();

    expect(result.lastChangeType).toBe("HIKE");
    expect(result.lastChangeBps).toBe(175);
  });

  it("marks an unchanged consecutive rate as HOLD in the table itself", async () => {
    mockUrls(rateTableHtml([["10 Jan 2099", "12.0"], ["10 Mar 2099", "12.0"]]), archiveHtml([]));

    await trackedIngest();

    const stored = await db.policyDecision.findFirstOrThrow({ where: { decisionDate: new Date("2099-03-10T00:00:00.000Z") } });
    expect(stored.decisionType).toBe("HOLD");
    expect(stored.changeBps).toBe(0);
  });

  it("does not duplicate a decision on a second identical run, and moves provenance on a corrected value", async () => {
    mockUrls(rateTableHtml([["15 Jan 2099", "9.0"]]), archiveHtml([]));
    const run1 = await trackedIngest();

    mockUrls(rateTableHtml([["15 Jan 2099", "9.0"]]), archiveHtml([]));
    const run2 = await trackedIngest();

    let count = await db.policyDecision.count({ where: { decisionDate: new Date("2099-01-15T00:00:00.000Z") } });
    expect(count).toBe(1);

    mockUrls(rateTableHtml([["15 Jan 2099", "9.25"]]), archiveHtml([])); // corrected value
    const run3 = await trackedIngest();

    count = await db.policyDecision.count({ where: { decisionDate: new Date("2099-01-15T00:00:00.000Z") } });
    expect(count).toBe(1);

    const stored = await db.policyDecision.findFirstOrThrow({ where: { decisionDate: new Date("2099-01-15T00:00:00.000Z") } });
    expect(stored.resultingRate.toString()).toBe("9.25");
    expect(stored.ingestionRunId).toBe(run3.rateTableRun.runId);
    expect(stored.ingestionRunId).not.toBe(run1.rateTableRun.runId);
    expect(stored.ingestionRunId).not.toBe(run2.rateTableRun.runId);
  });

  it("marks the rate-table run FAILED when the fetch throws, without touching the archive run", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === MPR_URL) throw new Error("simulated network failure");
      return archiveHtml([]);
    });

    const result = await trackedIngest();

    expect(result.rateTableRun.status).toBe("FAILED");
    expect(result.archiveRun.status).toBe("SUCCESS");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.rateTableRun.runId } });
    expect(run.errorMessage).toContain("simulated network failure");
  });
});

describe("ingestBogMpr — HOLD derivation from the press-release archive", () => {
  it("infers HOLD decisions for meetings confirmed after the rate table's latest entry", async () => {
    mockUrls(
      rateTableHtml([["20 Jan 2099", "20.0"], ["20 Mar 2099", "18.5"]]),
      archiveHtml([
        ["May 20, 2099", "MPC Press Release – May 2099"],
        ["July 22, 2099", "MPC Press Release – July 2099"],
        ["March 20, 2099", "MPC Press Release – March 2099"], // already in the table — must not be re-derived
      ]),
    );

    const result = await trackedIngest();

    expect(result.latestDecisionDate).toBe("2099-07-22");
    expect(result.latestDecisionType).toBe("HOLD");
    // The last actual CHANGE remains March, not the July hold:
    expect(result.lastChangeDate).toBe("2099-03-20");
    expect(result.lastChangeType).toBe("CUT");

    const mayHold = await db.policyDecision.findFirstOrThrow({ where: { decisionDate: new Date("2099-05-20T00:00:00.000Z") } });
    expect(mayHold.decisionType).toBe("HOLD");
    expect(mayHold.resultingRate.toString()).toBe("18.5");
    expect(mayHold.changeBps).toBe(0);

    const julyHold = await db.policyDecision.findFirstOrThrow({ where: { decisionDate: new Date("2099-07-22T00:00:00.000Z") } });
    expect(julyHold.decisionType).toBe("HOLD");
    expect(julyHold.resultingRate.toString()).toBe("18.5");

    // March was already a real table row — the archive must not overwrite it as a HOLD.
    const march = await db.policyDecision.findFirstOrThrow({ where: { decisionDate: new Date("2099-03-20T00:00:00.000Z") } });
    expect(march.decisionType).toBe("CUT");
  });

  it("is idempotent: re-running with the same archive does not duplicate the derived HOLD", async () => {
    mockUrls(rateTableHtml([["25 Jan 2099", "8.0"]]), archiveHtml([["March 25, 2099", "MPC Press Release – March 2099"]]));
    await trackedIngest();

    mockUrls(rateTableHtml([["25 Jan 2099", "8.0"]]), archiveHtml([["March 25, 2099", "MPC Press Release – March 2099"]]));
    await trackedIngest();

    const count = await db.policyDecision.count({ where: { decisionDate: new Date("2099-03-25T00:00:00.000Z") } });
    expect(count).toBe(1);
  });

  it("excludes non-decision archive entries (e.g. transcripts) from HOLD derivation", async () => {
    mockUrls(
      rateTableHtml([["01 Jan 2099", "7.0"]]),
      archiveHtml([["June 18, 2099", "Transcript – MPC Press Briefing"]]),
    );

    await trackedIngest();

    const count = await db.policyDecision.count({ where: { decisionDate: new Date("2099-06-18T00:00:00.000Z") } });
    expect(count).toBe(0);
  });

  it("marks the archive run FAILED when the fetch throws, without touching the rate-table run", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === ARCHIVE_URL) throw new Error("simulated network failure");
      return rateTableHtml([["01 Jan 2099", "7.0"]]);
    });

    const result = await trackedIngest();

    expect(result.archiveRun.status).toBe("FAILED");
    expect(result.rateTableRun.status).toBe("SUCCESS");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.archiveRun.runId } });
    expect(run.errorMessage).toContain("simulated network failure");
  });
});
