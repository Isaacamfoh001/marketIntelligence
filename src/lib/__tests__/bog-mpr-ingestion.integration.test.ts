// ---------------------------------------------------------------------------
// Integration tests for the Bank of Ghana Monetary Policy Rate ingestion.
//
// Real database, mocked HTTP. Synthetic decisions use dates in 2099 so
// cleanup can target exactly what these tests create. Every IngestionRun
// created is tracked and deleted in afterAll — ingestBogMpr upserts
// against the same DataSource/MacroSeries live ingestion uses.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  createdRunIds.push(result.runId);
  return result;
}

function htmlTable(rows: string[][]): string {
  const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("\n");
  return `<html><body><table><tbody>${body}</tbody></table></body></html>`;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterAll(async () => {
  await db.macroObservation.deleteMany({ where: { series: { code: "BOG_MPR" }, observationDate: { gte: SYNTHETIC_FLOOR } } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
});

describe("ingestBogMpr", () => {
  it("parses and persists decisions with provenance, preserving the effective date", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlTable([
        ["1", "January 1 – 2, 2099", "01 Jan 2099", "20.0"],
        ["2", "March 1 – 2, 2099", "01 Mar 2099", "18.5"],
      ]),
    );

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(2);
    expect(result.recordsAccepted).toBe(2);
    expect(result.persisted).toBe(2);
    expect(result.latestRate).toBe("18.5");
    expect(result.latestEffectiveDate).toBe("2099-03-01");

    const stored = await db.macroObservation.findFirst({
      where: { observationDate: new Date("2099-01-01T00:00:00.000Z"), series: { code: "BOG_MPR" } },
      include: { series: { include: { source: true } }, ingestionRun: true },
    });
    expect(stored).not.toBeNull();
    expect(stored!.value.toString()).toBe("20");
    // Provenance chain: MacroObservation -> IngestionRun -> DataSource -> Bank of Ghana
    expect(stored!.ingestionRunId).toBe(result.runId);
    expect(stored!.ingestionRun.dataSourceId).toBe(stored!.series.sourceId);
    expect(stored!.series.source.provider).toBe("Bank of Ghana");
    expect(stored!.series.frequency).toBe("AD_HOC");
  });

  it("does not duplicate a decision on a second identical run, and moves provenance on a corrected value", async () => {
    mockFetch.mockResolvedValueOnce(htmlTable([["3", "May 1 – 2, 2099", "01 May 2099", "17.0"]]));
    const run1 = await trackedIngest();

    mockFetch.mockResolvedValueOnce(htmlTable([["3", "May 1 – 2, 2099", "01 May 2099", "17.0"]]));
    const run2 = await trackedIngest();

    let count = await db.macroObservation.count({ where: { observationDate: new Date("2099-05-01T00:00:00.000Z") } });
    expect(count).toBe(1);

    // BoG corrects a published rate for the same effective date.
    mockFetch.mockResolvedValueOnce(htmlTable([["3", "May 1 – 2, 2099", "01 May 2099", "17.25"]]));
    const run3 = await trackedIngest();

    count = await db.macroObservation.count({ where: { observationDate: new Date("2099-05-01T00:00:00.000Z") } });
    expect(count).toBe(1);

    const stored = await db.macroObservation.findFirstOrThrow({ where: { observationDate: new Date("2099-05-01T00:00:00.000Z") } });
    expect(stored.value.toString()).toBe("17.25");
    expect(stored.ingestionRunId).toBe(run3.runId);
    expect(stored.ingestionRunId).not.toBe(run1.runId);
    expect(stored.ingestionRunId).not.toBe(run2.runId);
  });

  it("rejects malformed rows without persisting them or failing the run", async () => {
    mockFetch.mockResolvedValueOnce(
      htmlTable([
        ["4", "July 1 – 2, 2099", "01 Jul 2099", "N/A"], // bad rate
        ["5", "August 1 – 2, 2099", "40 Aug 2099", "16.0"], // bad date
      ]),
    );

    const result = await trackedIngest();

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsRead).toBe(2);
    expect(result.recordsAccepted).toBe(0);
    expect(result.recordsRejected).toBe(2);
    expect(result.persisted).toBe(0);

    const count = await db.macroObservation.count({ where: { observationDate: new Date("2099-07-01T00:00:00.000Z") } });
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
