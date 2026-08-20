// ---------------------------------------------------------------------------
// Tests for the browser upload Server Actions (M6.1). These exercise the
// FormData/file-validation wiring specific to this layer (extension, size,
// dataset-type dispatch, error shape) — the underlying parsing/validation/
// persistence logic is already covered by gse-security-parser.test.ts,
// gse-index-parser.test.ts, and the two *-ingestion.integration.test.ts
// suites, so this file does not re-test those in depth.
//
// Real database. Synthetic ticker (ZZACT1) can never collide with a real
// GSE share code — see gse-security-ingestion.integration.test.ts for the
// same isolation pattern. Every IngestionRun created is tracked and
// deleted in afterAll.
// ---------------------------------------------------------------------------

import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getPrisma } from "@/lib/prisma";
import { previewGseImportAction, commitGseImportAction } from "../actions";

const db = getPrisma();
const TEST_TICKERS = ["ZZACT1"];
const createdRunIds: string[] = [];

function csvFile(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

function buildFormData(datasetType: string | null, file: File | null): FormData {
  const fd = new FormData();
  if (datasetType) fd.set("datasetType", datasetType);
  if (file) fd.set("file", file);
  return fd;
}

function trackRun(result: { security?: { runId: string | null }; index?: { runId: string | null } }) {
  const runId = result.security?.runId ?? result.index?.runId;
  if (runId) createdRunIds.push(runId);
}

afterEach(async () => {
  const secs = await db.security.findMany({ where: { ticker: { in: TEST_TICKERS } }, select: { id: true } });
  await db.securityPrice.deleteMany({ where: { securityId: { in: secs.map((s) => s.id) } } });
});

afterAll(async () => {
  await db.marketIndexObservation.deleteMany({ where: { observationDate: new Date("2026-08-21T00:00:00.000Z") } });
  await db.ingestionRun.deleteMany({ where: { id: { in: createdRunIds } } });
  const secs = await db.security.findMany({ where: { ticker: { in: TEST_TICKERS } } });
  await db.security.deleteMany({ where: { id: { in: secs.map((s) => s.id) } } });
  await db.company.deleteMany({ where: { id: { in: secs.map((s) => s.companyId) }, securities: { none: {} } } });
});

describe("previewGseImportAction — input validation", () => {
  it("errors when no dataset type is selected", async () => {
    const result = await previewGseImportAction(buildFormData(null, csvFile("x.csv", "a\n1\n")));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dataset type");
  });

  it("errors when no file is provided", async () => {
    const result = await previewGseImportAction(buildFormData("security-daily", null));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No file");
  });

  it("rejects an unsupported extension", async () => {
    const result = await previewGseImportAction(buildFormData("security-daily", csvFile("prices.pdf", "whatever")));
    expect(result.ok).toBe(false);
    expect(result.error).toContain(".csv, .xlsx, or .xls");
  });

  it("rejects an oversized file without reading it into the parser", async () => {
    const big = "a".repeat(11 * 1024 * 1024);
    const result = await previewGseImportAction(buildFormData("security-daily", csvFile("big.csv", big)));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("exceeds");
  });

  it("rejects a zero-byte file", async () => {
    const result = await previewGseImportAction(buildFormData("security-daily", csvFile("empty.csv", "")));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("empty");
  });
});

describe("previewGseImportAction — preview does not persist", () => {
  it("previews a valid CSV, reporting row-level diagnostics, without writing to the database", async () => {
    const csv = "Trading Date,Share Code,Closing Price - VWAP\n2026-08-17,ZZACT1,2.50\n2026-08-18,ZZACT1,not-a-price\n";
    const result = await previewGseImportAction(buildFormData("security-daily", csvFile("prices.csv", csv)));

    expect(result.ok).toBe(true);
    expect(result.security?.status).toBe("PREVIEW");
    expect(result.security?.recordsAccepted).toBe(1);
    expect(result.security?.recordsRejected).toBe(1);
    expect(result.security?.errors[0].rowNumber).toBe(3);
    expect(result.security?.errors[0].errors.join(" ")).toContain("close_vwap");

    const sec = await db.security.findUnique({ where: { ticker: "ZZACT1" } });
    expect(sec).toBeNull();
  });
});

describe("commitGseImportAction", () => {
  it("persists a valid CSV with provenance triggeredBy = web (not cli)", async () => {
    const csv = "Trading Date,Share Code,Closing Price - VWAP\n2026-08-17,ZZACT1,2.50\n";
    const result = await commitGseImportAction(buildFormData("security-daily", csvFile("prices.csv", csv)));
    trackRun(result);

    expect(result.security?.status).toBe("SUCCESS");
    const run = await db.ingestionRun.findUniqueOrThrow({ where: { id: result.security!.runId! } });
    expect(run.triggeredBy).toBe("web");
  });

  it("is idempotent across a repeated commit of the same file", async () => {
    const csv = "Trading Date,Share Code,Closing Price - VWAP\n2026-08-18,ZZACT1,2.60\n";
    const r1 = await commitGseImportAction(buildFormData("security-daily", csvFile("prices.csv", csv)));
    trackRun(r1);
    const r2 = await commitGseImportAction(buildFormData("security-daily", csvFile("prices.csv", csv)));
    trackRun(r2);

    expect(r2.security?.inserted).toBe(0);
    expect(r2.security?.updated).toBe(1);
  });

  it("reports a conflict when a lower-priority backfill import disagrees with an existing daily-priority value", async () => {
    const daily = "Trading Date,Share Code,Closing Price - VWAP\n2026-08-19,ZZACT1,2.50\n";
    const r1 = await commitGseImportAction(buildFormData("security-daily", csvFile("daily.csv", daily)));
    trackRun(r1);

    const backfill = "Trading Date,Share Code,Closing Price - VWAP\n2026-08-19,ZZACT1,2.90\n";
    const r2 = await commitGseImportAction(buildFormData("security-backfill", csvFile("backfill.csv", backfill)));
    trackRun(r2);

    expect(r2.security?.conflicts).toHaveLength(1);
    const stored = await db.securityPrice.findFirst({ where: { security: { ticker: "ZZACT1" }, tradingDate: new Date("2026-08-19T00:00:00.000Z") } });
    expect(Number(stored?.closeVwap)).toBe(2.5); // higher-priority daily value retained
  });

  it("commits a real .xlsx file end to end through the action layer", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Trading Date", "Share Code", "Closing Price - VWAP"]);
    sheet.addRow(["2026-08-20", "ZZACT1", 2.75]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as ArrayBuffer;
    const file = new File([buffer], "prices.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    const result = await commitGseImportAction(buildFormData("security-daily", file));
    trackRun(result);

    expect(result.security?.status).toBe("SUCCESS");
    expect(result.security?.persisted).toBe(1);
    const stored = await db.securityPrice.findFirst({ where: { security: { ticker: "ZZACT1" }, tradingDate: new Date("2026-08-20T00:00:00.000Z") } });
    expect(Number(stored?.closeVwap)).toBe(2.75);
  });

  it("routes a market-summary dataset through importGseMarketSummary, not the security provider", async () => {
    const csv = "Trading Date,GSE-CI\n2026-08-21,6100.00\n";
    const result = await commitGseImportAction(buildFormData("market-summary", csvFile("summary.csv", csv)));
    trackRun(result);

    expect(result.index?.status).toBe("SUCCESS");
    expect(result.security).toBeUndefined();
  });
});
