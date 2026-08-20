// ---------------------------------------------------------------------------
// Integration tests for the Bank of Ghana FX ingestion pipeline.
//
// The database is real (per project convention — DB behavior is what's
// under test). External HTTP is mocked: these tests must not depend on
// bog.gov.gh being online. Synthetic rows use dates in 2099 so cleanup
// can target exactly the rows these tests create without touching any
// real historical BoG data already ingested by `npm run ingest:bog-fx`.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/http", () => ({
  fetchBogText: vi.fn(),
  postBogForm: vi.fn(),
}));

import { fetchBogText, postBogForm } from "../ingestion/http";
import { ingestBogFxDaily, ingestBogFxBackfill } from "../ingestion/bog-fx-provider";

const db = getPrisma();
const mockFetch = vi.mocked(fetchBogText);
const mockPost = vi.mocked(postBogForm);

const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");

// ingestBogFxDaily/ingestBogFxBackfill upsert against the SAME DataSource
// row live ingestion uses (there's no test-only source to isolate into —
// DataSource identity is the provider's own upsert-by-name). Every run
// these tests create is tracked here and deleted in afterAll, so a test
// run — including the deliberately FAILED ones — never lingers as the
// "latest run" Data Centre reports for the real source.
const createdRunIds: string[] = [];
async function trackedIngestBogFxDaily(...args: Parameters<typeof ingestBogFxDaily>) {
  const result = await ingestBogFxDaily(...args);
  createdRunIds.push(result.runId);
  return result;
}
async function trackedIngestBogFxBackfill(...args: Parameters<typeof ingestBogFxBackfill>) {
  const result = await ingestBogFxBackfill(...args);
  createdRunIds.push(result.runId);
  return result;
}

function dailyHtml(rows: string[][]): string {
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

function historicalPageHtml(): string {
  return `
    <input id="wdtNonceFrontendServerSide_40" name="wdtNonceFrontendServerSide_40" value="deadbeef00" />
    <input id="table_1_desc" value='{"tableWpId":40}' />
  `;
}

function ajaxJson(rows: string[][]): string {
  return JSON.stringify({ draw: 1, recordsTotal: rows.length, recordsFiltered: rows.length, data: rows });
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPost.mockReset();
});

afterAll(async () => {
  await db.exchangeRate.deleteMany({ where: { observationDate: { gte: SYNTHETIC_FLOOR } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestBogFxDaily", () => {
  it("persists a valid row and marks the run SUCCESS with provenance", async () => {
    mockFetch.mockResolvedValueOnce(
      dailyHtml([["01 Jan 2099", "US Dollar", "USDGHS", "11.0695", "11.0805", "11.0750"]]),
    );

    const result = await trackedIngestBogFxDaily("USDGHS");

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(1);
    expect(result.recordsAccepted).toBe(1);
    expect(result.persisted).toBe(1);
    expect(result.latestObservationDate).toBe("2099-01-01");

    const stored = await db.exchangeRate.findFirst({
      where: { observationDate: new Date("2099-01-01T00:00:00.000Z") },
      include: { currencyPair: true, source: true, ingestionRun: true },
    });
    expect(stored).not.toBeNull();
    expect(stored!.midRate.toString()).toBe("11.075");
    // Provenance chain: ExchangeRate -> IngestionRun -> DataSource -> Bank of Ghana
    expect(stored!.ingestionRunId).toBe(result.runId);
    expect(stored!.ingestionRun.dataSourceId).toBe(stored!.sourceId);
    expect(stored!.source.provider).toBe("Bank of Ghana");
    expect(stored!.currencyPair.code).toBe("USDGHS");
  });

  it("does not duplicate the observation on a second identical run, and moves provenance on a corrected value", async () => {
    mockFetch.mockResolvedValueOnce(
      dailyHtml([["02 Jan 2099", "US Dollar", "USDGHS", "11.0000", "11.0200", "11.0100"]]),
    );
    const run1 = await trackedIngestBogFxDaily("USDGHS");

    mockFetch.mockResolvedValueOnce(
      dailyHtml([["02 Jan 2099", "US Dollar", "USDGHS", "11.0000", "11.0200", "11.0100"]]),
    );
    const run2 = await trackedIngestBogFxDaily("USDGHS");

    let count = await db.exchangeRate.count({ where: { observationDate: new Date("2099-01-02T00:00:00.000Z") } });
    expect(count).toBe(1);

    // BoG republishes a corrected mid rate for the same date.
    mockFetch.mockResolvedValueOnce(
      dailyHtml([["02 Jan 2099", "US Dollar", "USDGHS", "11.0050", "11.0250", "11.0150"]]),
    );
    const run3 = await trackedIngestBogFxDaily("USDGHS");

    count = await db.exchangeRate.count({ where: { observationDate: new Date("2099-01-02T00:00:00.000Z") } });
    expect(count).toBe(1);

    const stored = await db.exchangeRate.findFirstOrThrow({
      where: { observationDate: new Date("2099-01-02T00:00:00.000Z") },
    });
    expect(stored.midRate.toString()).toBe("11.015");
    expect(stored.ingestionRunId).toBe(run3.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
    expect(stored.ingestionRunId).not.toBe(run2.runId);
  });

  it("ignores currency pairs outside the ingestion's scope without counting or rejecting them", async () => {
    mockFetch.mockResolvedValueOnce(
      dailyHtml([
        ["05 Jan 2099", "Pound Sterling", "GBPGHS", "15.0", "15.1", "15.05"],
        ["05 Jan 2099", "US Dollar", "USDGHS", "11.0", "11.1", "11.05"],
      ]),
    );

    const result = await trackedIngestBogFxDaily("USDGHS");

    expect(result.recordsRead).toBe(1); // GBPGHS not counted
    expect(result.recordsAccepted).toBe(1);
    expect(result.recordsRejected).toBe(0);

    const gbp = await db.currencyPair.findUnique({ where: { code: "GBPGHS" } });
    expect(gbp).toBeNull(); // never created — out of scope, not silently ingested
  });

  it("rejects malformed rows without persisting them or failing the run", async () => {
    mockFetch.mockResolvedValueOnce(
      dailyHtml([
        ["10 Jan 2099", "US Dollar", "USDGHS", "11.0", "11.1", "N/A"], // bad mid rate
        ["40 Jan 2099", "US Dollar", "USDGHS", "11.0", "11.1", "11.05"], // bad date
      ]),
    );

    const result = await trackedIngestBogFxDaily("USDGHS");

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(2);
    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsRejected).toBe(2);
    expect(result.persisted).toBe(0);
    expect(result.errors).toHaveLength(2);

    const count = await db.exchangeRate.count({ where: { observationDate: new Date("2099-01-10T00:00:00.000Z") } });
    expect(count).toBe(0);
  });

  it("marks the run FAILED with completedAt and an error message when the fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("simulated network failure"));

    const result = await trackedIngestBogFxDaily("USDGHS");

    expect(result.status).toBe("FAILED");

    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.completedAt).not.toBeNull();
    expect(run.errorMessage).toContain("simulated network failure");
  });
});

describe("ingestBogFxBackfill", () => {
  it("persists only rows on/after fromDate and is idempotent on repeat", async () => {
    mockFetch.mockResolvedValue(historicalPageHtml());
    mockPost.mockResolvedValue(
      ajaxJson([
        ["20 Jan 2099", "US Dollar", "USDGHS", "11.20", "11.22", "11.21"],
        ["19 Jan 2099", "US Dollar", "USDGHS", "11.10", "11.12", "11.11"],
        ["18 Dec 2098", "US Dollar", "USDGHS", "10.90", "10.92", "10.91"], // before fromDate
      ]),
    );

    const result = await trackedIngestBogFxBackfill("USDGHS", "2099-01-01", 100);
    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(3);
    expect(result.recordsAccepted).toBe(2); // 2098 row excluded by fromDate
    expect(result.persisted).toBe(2);

    const outOfRange = await db.exchangeRate.findFirst({
      where: { observationDate: new Date("2098-12-18T00:00:00.000Z") },
    });
    expect(outOfRange).toBeNull();

    // Re-run: same rows must not duplicate.
    mockFetch.mockResolvedValue(historicalPageHtml());
    mockPost.mockResolvedValue(
      ajaxJson([
        ["20 Jan 2099", "US Dollar", "USDGHS", "11.20", "11.22", "11.21"],
        ["19 Jan 2099", "US Dollar", "USDGHS", "11.10", "11.12", "11.11"],
      ]),
    );
    await trackedIngestBogFxBackfill("USDGHS", "2099-01-01", 100);

    const count = await db.exchangeRate.count({
      where: {
        observationDate: {
          in: [new Date("2099-01-19T00:00:00.000Z"), new Date("2099-01-20T00:00:00.000Z")],
        },
      },
    });
    expect(count).toBe(2);
  });

  it("marks the run FAILED when the historical page structure can't be parsed (missing nonce)", async () => {
    mockFetch.mockResolvedValueOnce("<html><body>no wpDataTables config here</body></html>");

    const result = await trackedIngestBogFxBackfill("USDGHS", "2099-01-01");

    expect(result.status).toBe("FAILED");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toContain("nonce");
  });
});
