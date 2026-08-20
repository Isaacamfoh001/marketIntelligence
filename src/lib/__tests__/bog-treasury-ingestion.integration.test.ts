// ---------------------------------------------------------------------------
// Integration tests for the Bank of Ghana Treasury Bill ingestion pipeline.
//
// Real database, mocked HTTP (see bog-fx-ingestion.integration.test.ts for
// the pattern this mirrors). Synthetic rows use dates in 2099 so cleanup
// can target exactly what these tests create. Every IngestionRun created
// is tracked and deleted in afterAll — ingestBogTreasury/Backfill upsert
// against the same DataSource live ingestion uses, so an untracked test
// run would otherwise linger as the "latest run" Data Centre reports.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../prisma";

vi.mock("../ingestion/http", () => ({
  fetchBogText: vi.fn(),
  postBogForm: vi.fn(),
}));

import { fetchBogText, postBogForm } from "../ingestion/http";
import { ingestBogTreasury, ingestBogTreasuryBackfill } from "../ingestion/bog-treasury-provider";

const db = getPrisma();
const mockFetch = vi.mocked(fetchBogText);
const mockPost = vi.mocked(postBogForm);

const SYNTHETIC_FLOOR = new Date("2099-01-01T00:00:00.000Z");
const createdRunIds: string[] = [];

async function trackedIngest(...args: Parameters<typeof ingestBogTreasury>) {
  const result = await ingestBogTreasury(...args);
  createdRunIds.push(result.runId);
  return result;
}
async function trackedIngestBackfill(...args: Parameters<typeof ingestBogTreasuryBackfill>) {
  const result = await ingestBogTreasuryBackfill(...args);
  createdRunIds.push(result.runId);
  return result;
}

function dailyHtml(rows: string[][]): string {
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

function historicalPageHtml(): string {
  return `
    <input id="wdtNonceFrontendServerSide_2" name="wdtNonceFrontendServerSide_2" value="deadbeef00" />
    <input id="table_1_desc" value='{"tableWpId":2}' />
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
  await db.treasuryRate.deleteMany({ where: { observationDate: { gte: SYNTHETIC_FLOOR } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestBogTreasury", () => {
  it("persists 91/182/364-day rows with provenance, ignoring other tenors", async () => {
    mockFetch.mockResolvedValueOnce(
      dailyHtml([
        ["01 Jan 2099", "9001", "91 DAY BILL", "5.0000", "5.1000"],
        ["01 Jan 2099", "9001", "182 DAY BILL", "6.0000", "6.2000"],
        ["01 Jan 2099", "9001", "364 DAY BILL", "9.0000", "9.5000"],
        ["01 Jan 2099", "9001", "5 YR FXR BOND", "20.0", "21.0"], // out of scope
      ]),
    );

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(3); // bond not counted
    expect(result.recordsAccepted).toBe(3);
    expect(result.persisted).toBe(3);
    expect(result.latestBySecurityType["91 DAY BILL"]).toBe("2099-01-01");

    const stored = await db.treasuryRate.findFirst({
      where: { observationDate: new Date("2099-01-01T00:00:00.000Z"), instrument: { code: "91_DAY_BILL" } },
      include: { instrument: true, source: true, ingestionRun: true },
    });
    expect(stored).not.toBeNull();
    expect(stored!.interestRate.toString()).toBe("5.1");
    expect(stored!.tenderNumber).toBe("9001");
    // Provenance chain: TreasuryRate -> IngestionRun -> DataSource -> Bank of Ghana
    expect(stored!.ingestionRunId).toBe(result.runId);
    expect(stored!.ingestionRun.dataSourceId).toBe(stored!.sourceId);
    expect(stored!.source.provider).toBe("Bank of Ghana");
    expect(stored!.instrument.tenorDays).toBe(91);
  });

  it("does not duplicate on a second identical run, and moves provenance on a corrected rate", async () => {
    mockFetch.mockResolvedValueOnce(dailyHtml([["02 Jan 2099", "9002", "91 DAY BILL", "5.0000", "5.1000"]]));
    const run1 = await trackedIngest();

    mockFetch.mockResolvedValueOnce(dailyHtml([["02 Jan 2099", "9002", "91 DAY BILL", "5.0000", "5.1000"]]));
    const run2 = await trackedIngest();

    let count = await db.treasuryRate.count({ where: { observationDate: new Date("2099-01-02T00:00:00.000Z") } });
    expect(count).toBe(1);

    // BoG republishes a corrected interest rate for the same auction.
    mockFetch.mockResolvedValueOnce(dailyHtml([["02 Jan 2099", "9002", "91 DAY BILL", "5.0100", "5.1200"]]));
    const run3 = await trackedIngest();

    count = await db.treasuryRate.count({ where: { observationDate: new Date("2099-01-02T00:00:00.000Z") } });
    expect(count).toBe(1);

    const stored = await db.treasuryRate.findFirstOrThrow({ where: { observationDate: new Date("2099-01-02T00:00:00.000Z") } });
    expect(stored.interestRate.toString()).toBe("5.12");
    expect(stored.ingestionRunId).toBe(run3.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
    expect(stored.ingestionRunId).not.toBe(run2.runId);
  });

  it("rejects malformed rows without persisting them or failing the run", async () => {
    mockFetch.mockResolvedValueOnce(
      dailyHtml([
        ["03 Jan 2099", "9003", "91 DAY BILL", "5.0", "N/A"], // bad interest rate
        ["03 Jan 2099", "9003", "182 DAY BILL", "9.0", "8.0"], // interest below discount
      ]),
    );

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(2);
    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsRejected).toBe(2);
    expect(result.persisted).toBe(0);

    const count = await db.treasuryRate.count({ where: { observationDate: new Date("2099-01-03T00:00:00.000Z") } });
    expect(count).toBe(0);
  });

  it("marks the run FAILED with completedAt and an error message when the fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("simulated network failure"));

    const result = await trackedIngest();

    expect(result.status).toBe("FAILED");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.completedAt).not.toBeNull();
    expect(run.errorMessage).toContain("simulated network failure");
  });
});

describe("ingestBogTreasuryBackfill", () => {
  it("persists only rows on/after fromDate across all three tenors, and is idempotent on repeat", async () => {
    mockFetch.mockResolvedValue(historicalPageHtml());
    mockPost.mockImplementation(async (_url, _referer, form) => {
      const type = form["columns[2][search][value]"];
      return ajaxJson([
        ["20 Jan 2099", "9010", type, "5.0", "5.1"],
        ["18 Dec 2098", "9009", type, "4.9", "5.0"], // before fromDate
      ]);
    });

    const result = await trackedIngestBackfill("2099-01-01", 50);
    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(6); // 2 rows x 3 tenors
    expect(result.recordsAccepted).toBe(3); // only the 2099 row per tenor

    const outOfRange = await db.treasuryRate.count({ where: { observationDate: new Date("2098-12-18T00:00:00.000Z") } });
    expect(outOfRange).toBe(0);

    const inRangeCount = await db.treasuryRate.count({ where: { observationDate: new Date("2099-01-20T00:00:00.000Z") } });
    expect(inRangeCount).toBe(3);

    // Re-run: same rows must not duplicate.
    await trackedIngestBackfill("2099-01-01", 50);
    const countAfterRepeat = await db.treasuryRate.count({ where: { observationDate: new Date("2099-01-20T00:00:00.000Z") } });
    expect(countAfterRepeat).toBe(3);
  });

  it("marks the run FAILED when the page structure can't be parsed (missing nonce)", async () => {
    mockFetch.mockResolvedValueOnce("<html><body>no wpDataTables config here</body></html>");

    const result = await trackedIngestBackfill("2099-01-01");

    expect(result.status).toBe("FAILED");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run.status).toBe("FAILED");
    expect(run.errorMessage).toContain("nonce");
  });
});
