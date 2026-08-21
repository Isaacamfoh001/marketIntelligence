"use server";

// ---------------------------------------------------------------------------
// Server Actions backing the browser GSE import wizard.
//
// Deliberately thin: this file does no parsing, validation, or persistence
// of its own. It only (a) extracts and validates the uploaded File out of
// FormData, and (b) calls the exact same importGseSecurityPrices /
// importGseMarketSummary functions the CLI scripts (import-gse-security-
// prices.ts / import-gse-market-summary.ts) already call — one ingestion
// implementation, two entry points (M6.1 §2).
// ---------------------------------------------------------------------------

import { importGseSecurityPrices, type GseSecurityImportResult } from "@/lib/ingestion/gse-security-provider";
import { importGseMarketSummary, type GseIndexImportResult } from "@/lib/ingestion/gse-index-provider";
import { importCompanyFinancials, type FinancialsImportResult } from "@/lib/ingestion/financials-provider";
import {
  MAX_UPLOAD_BYTES,
  hasAcceptedExtension,
  datasetTypeToSecurityKind,
  type GseDatasetType,
} from "@/lib/gse-import-templates";

export interface ImportActionResult {
  ok: boolean;
  error?: string;
  datasetType?: GseDatasetType;
  filename?: string;
  security?: GseSecurityImportResult;
  index?: GseIndexImportResult;
  financials?: FinancialsImportResult;
}

async function extractFile(formData: FormData): Promise<{ filename: string; buffer: Buffer } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file was provided." };
  if (file.size === 0) return { error: "The selected file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB, which exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit.`,
    };
  }
  if (!hasAcceptedExtension(file.name)) {
    return { error: `Unsupported file type: "${file.name}" — expected .csv, .xlsx, or .xls.` };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  return { filename: file.name, buffer };
}

function readDatasetType(formData: FormData): GseDatasetType | null {
  const value = formData.get("datasetType");
  if (value === "security-daily" || value === "security-backfill" || value === "market-summary" || value === "company-financials") return value;
  return null;
}

async function runImport(formData: FormData, commit: boolean): Promise<ImportActionResult> {
  const datasetType = readDatasetType(formData);
  if (!datasetType) return { ok: false, error: "No dataset type selected." };

  const extracted = await extractFile(formData);
  if ("error" in extracted) return { ok: false, error: extracted.error, datasetType };
  const { filename, buffer } = extracted;

  if (datasetType === "market-summary") {
    // The browser wizard's "GSE Market Summary" card is for a genuinely
    // daily CSV/Excel export (see gse-import-templates.ts) — the monthly
    // PDF-report path (M8.1) is a separate, explicitly-labeled CLI flow
    // (scripts/import-gse-market-summary.ts --kind=monthly-report), not
    // yet exposed here.
    const index = await importGseMarketSummary(filename, buffer, "daily", { commit, triggeredBy: "web" });
    return { ok: true, datasetType, filename, index };
  }

  if (datasetType === "company-financials") {
    const financials = await importCompanyFinancials(filename, buffer, { commit, triggeredBy: "web" });
    return { ok: true, datasetType, filename, financials };
  }

  const kind = datasetTypeToSecurityKind(datasetType);
  const security = await importGseSecurityPrices(filename, buffer, kind, { commit, triggeredBy: "web" });
  return { ok: true, datasetType, filename, security };
}

/** Parses and validates only — never persists (CLAUDE.md §20: no mutation on file selection). */
export async function previewGseImportAction(formData: FormData): Promise<ImportActionResult> {
  return runImport(formData, false);
}

/** Persists through the full startRun/validate/persist/completeRun|failRun pipeline. */
export async function commitGseImportAction(formData: FormData): Promise<ImportActionResult> {
  return runImport(formData, true);
}
