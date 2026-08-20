"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { previewGseImportAction, commitGseImportAction, type ImportActionResult } from "@/app/data-centre/import/actions";
import { GSE_IMPORT_TEMPLATES, buildCsvTemplate, MAX_UPLOAD_BYTES, hasAcceptedExtension, type GseDatasetType } from "@/lib/gse-import-templates";
import type { NormalisedGseSecurityRow } from "@/lib/ingestion/gse-security-parser";
import type { NormalisedGseIndexRow } from "@/lib/ingestion/gse-index-parser";
import type { NormalisedFinancialRow } from "@/lib/ingestion/financials-parser";
import { formatPeriodLabel } from "@/lib/financial-period-label";

const DATASET_TYPES: GseDatasetType[] = ["security-daily", "market-summary", "company-financials", "security-backfill"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function downloadCsvTemplate(type: GseDatasetType) {
  const spec = GSE_IMPORT_TEMPLATES[type];
  const blob = new Blob([buildCsvTemplate(type)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = spec.templateFilename;
  a.click();
  URL.revokeObjectURL(url);
}

function Banner({ tone, children }: { tone: "success" | "error" | "warning"; children: React.ReactNode }) {
  const styles: Record<string, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300",
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300",
  };
  const icon = tone === "success" ? "✓" : tone === "error" ? "✕" : "⚠";
  return (
    <div className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${styles[tone]}`}>
      <span aria-hidden className="mt-0.5 shrink-0 font-semibold">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One result type per dataset (security/index/financials) carries the same
// core fields under different names — normalized here once so the rest of
// the component never repeats a 3-way `??` chain.
// ---------------------------------------------------------------------------

interface RowError {
  row: unknown;
  errors: string[];
  rowNumber: number;
}

interface ResultSummary {
  recordsRead: number;
  recordsAccepted: number;
  recordsRejected: number;
  inserted: number;
  updated: number;
  conflicts: number;
  restatements: number;
  status: string;
  runId: string | null;
  /** The 4th summary-stat card — varies by dataset (a count for securities/financials, a date range for market summary). */
  fourthStatLabel: string;
  fourthStatValue: string | number;
  /** Optional caption line below the stat grid (date range + ticker list for securities, company list for financials). */
  captionLine: string | null;
  errors: RowError[];
  sourceLabel: string;
}

function summarize(result: ImportActionResult): ResultSummary | null {
  if (result.security) {
    const s = result.security;
    const dateRange = `${s.earliestTradingDate ?? "—"} → ${s.latestTradingDate ?? "—"}`;
    return {
      recordsRead: s.recordsRead,
      recordsAccepted: s.recordsAccepted,
      recordsRejected: s.recordsRejected,
      inserted: s.inserted,
      updated: s.updated,
      conflicts: s.conflicts.length,
      restatements: 0,
      status: s.status,
      runId: s.runId,
      fourthStatLabel: "Securities detected",
      fourthStatValue: s.tickers.length,
      captionLine: s.tickers.length > 0 ? `Trading date range: ${dateRange} · ${s.tickers.join(", ")}` : `Trading date range: ${dateRange}`,
      errors: s.errors,
      sourceLabel: `Ghana Stock Exchange — ${s.kind === "backfill" ? "Market Report Backfill" : "Daily Shares & ETFs"}`,
    };
  }
  if (result.index) {
    const i = result.index;
    return {
      recordsRead: i.recordsRead,
      recordsAccepted: i.recordsAccepted,
      recordsRejected: i.recordsRejected,
      inserted: i.inserted,
      updated: i.updated,
      conflicts: 0,
      restatements: 0,
      status: i.status,
      runId: i.runId,
      fourthStatLabel: "Trading date range",
      fourthStatValue: `${i.earliestTradingDate ?? "—"} → ${i.latestTradingDate ?? "—"}`,
      captionLine: null,
      errors: i.errors,
      sourceLabel: "Ghana Stock Exchange — Daily Market Summary",
    };
  }
  if (result.financials) {
    const f = result.financials;
    return {
      recordsRead: f.recordsRead,
      recordsAccepted: f.recordsAccepted,
      recordsRejected: f.recordsRejected,
      inserted: f.inserted,
      updated: f.updated,
      conflicts: 0,
      restatements: f.restatements.length,
      status: f.status,
      runId: f.runId,
      fourthStatLabel: "Companies detected",
      fourthStatValue: f.tickers.length,
      captionLine: f.tickers.length > 0 ? f.tickers.join(", ") : null,
      errors: f.errors,
      sourceLabel: "Ghana Stock Exchange — Listed Company Financial Statements",
    };
  }
  return null;
}

function SecurityPreviewTable({ rows }: { rows: NormalisedGseSecurityRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Ticker</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Close</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Volume</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Value Traded</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{formatDate(r.tradingDate)}</td>
              <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{r.ticker}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{r.closeVwap}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.sharesTraded ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.valueTraded ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-emerald-600 dark:text-emerald-400">✓ Valid</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndexPreviewTable({ rows }: { rows: NormalisedGseIndexRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Date</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">GSE-CI</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">GSE-FSI</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Market Cap</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Volume</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{formatDate(r.tradingDate)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{r.gseCi ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{r.gseFsi ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.marketCapGhs ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{r.totalVolume ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-emerald-600 dark:text-emerald-400">✓ Valid</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinancialsPreviewTable({ rows }: { rows: NormalisedFinancialRow[] }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Company</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Period</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Metric</th>
            <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Value</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Unit</th>
            <th className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/50">
              <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{r.ticker}</td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                {formatPeriodLabel(r)} · {r.statementScope === "CONSOLIDATED" ? "Group" : "Separate"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.metricCode}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">{r.value}</td>
              <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.unit}</td>
              <td className="whitespace-nowrap px-3 py-2 text-emerald-600 dark:text-emerald-400">✓ Valid</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const MAX_REJECTED_SHOWN = 20;

function RejectedRowsList({ errors }: { errors: RowError[] }) {
  if (errors.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Rejected rows ({errors.length}{errors.length > MAX_REJECTED_SHOWN ? `, showing first ${MAX_REJECTED_SHOWN}` : ""})
      </p>
      <ul className="space-y-1.5">
        {errors.slice(0, MAX_REJECTED_SHOWN).map((e, i) => (
          <li key={i} className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm dark:border-red-900/50 dark:bg-red-900/10">
            <span className="font-medium text-red-800 dark:text-red-300">Row {e.rowNumber || "?"}</span>{" "}
            <span className="text-red-700 dark:text-red-400">— {e.errors.join("; ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ImportWizard() {
  const [datasetType, setDatasetType] = useState<GseDatasetType>("security-daily");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<ImportActionResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportActionResult | null>(null);
  const [pending, setPending] = useState<"preview" | "commit" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const spec = GSE_IMPORT_TEMPLATES[datasetType];

  function selectDatasetType(type: GseDatasetType) {
    setDatasetType(type);
    setFile(null);
    setFileError(null);
    setPreviewResult(null);
    setCommitResult(null);
  }

  function selectFile(candidate: File | null) {
    setPreviewResult(null);
    setCommitResult(null);
    if (!candidate) {
      setFile(null);
      setFileError(null);
      return;
    }
    if (!hasAcceptedExtension(candidate.name)) {
      setFile(null);
      setFileError(`Unsupported file type: "${candidate.name}" — expected .csv, .xlsx, or .xls.`);
      return;
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setFileError(`"${candidate.name}" is ${formatBytes(candidate.size)}, which exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} upload limit.`);
      return;
    }
    setFileError(null);
    setFile(candidate);
  }

  async function handlePreview() {
    if (!file) return;
    setPending("preview");
    setCommitResult(null);
    const fd = new FormData();
    fd.set("datasetType", datasetType);
    fd.set("file", file);
    const result = await previewGseImportAction(fd);
    setPreviewResult(result);
    setPending(null);
  }

  async function handleConfirm() {
    if (!file) return;
    setPending("commit");
    const fd = new FormData();
    fd.set("datasetType", datasetType);
    fd.set("file", file);
    const result = await commitGseImportAction(fd);
    setCommitResult(result);
    setPending(null);
  }

  function handleReset() {
    setFile(null);
    setFileError(null);
    setPreviewResult(null);
    setCommitResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // ---------------------------------------------------------------------
  // Result screen (after a commit attempt) replaces the rest of the wizard.
  // ---------------------------------------------------------------------
  if (commitResult) {
    const summary = summarize(commitResult);
    const isSuccess = commitResult.ok && !commitResult.error && summary?.status === "SUCCESS";

    return (
      <div className="space-y-4">
        <Banner tone={isSuccess ? "success" : "error"}>
          <span className="font-medium">{isSuccess ? "Import Successful" : "Import Failed"}</span>
          {commitResult.error && <div className="mt-1">{commitResult.error}</div>}
        </Banner>

        {summary && (
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <SummaryStat label="Rows read" value={summary.recordsRead} />
              <SummaryStat label="Accepted" value={summary.recordsAccepted} />
              <SummaryStat label="Rejected" value={summary.recordsRejected} />
              <SummaryStat label="Inserted" value={summary.inserted} />
              <SummaryStat label="Updated" value={summary.updated} />
              <SummaryStat label="Conflicts" value={summary.conflicts} />
              <SummaryStat label={summary.fourthStatLabel} value={summary.fourthStatValue} />
              <SummaryStat label="Run status" value={summary.status} />
            </div>
            <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
              DataSource: {summary.sourceLabel} · Run ID: {summary.runId ?? "—"} · Imported {new Date().toLocaleString("en-GB")}
            </p>
            {summary.conflicts > 0 && (
              <div className="mt-3">
                <Banner tone="warning">
                  {summary.conflicts} conflict{summary.conflicts === 1 ? "" : "s"} retained existing higher-priority values (not overwritten).
                </Banner>
              </div>
            )}
            {summary.restatements > 0 && (
              <div className="mt-3">
                <Banner tone="warning">
                  {summary.restatements} value{summary.restatements === 1 ? "" : "s"} restated from a previous import — provenance moved to this run.
                </Banner>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Link href={datasetType === "company-financials" ? "/companies" : "/equities"} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            {datasetType === "company-financials" ? "View Companies" : "View Equities"}
          </Link>
          <Link href="/data-centre" className="rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800">
            View Data Centre
          </Link>
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Selection + preview flow
  // ---------------------------------------------------------------------
  const previewSummary = previewResult ? summarize(previewResult) : null;
  const canConfirm = previewResult?.ok && !previewResult.error && (previewSummary?.recordsAccepted ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">1. Choose dataset</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {DATASET_TYPES.map((type) => {
            const t = GSE_IMPORT_TEMPLATES[type];
            const selected = datasetType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => selectDatasetType(type)}
                className={`rounded border p-3 text-left transition-colors ${
                  selected
                    ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800"
                    : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                }`}
              >
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.label}</div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Required columns:</span> {spec.requiredHeaders.join(", ")}
          {spec.requiredNote ? ` (${spec.requiredNote})` : ""}
        </p>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Optional columns:</span> {spec.optionalHeaders.join(", ")}
        </p>
        <button type="button" onClick={() => downloadCsvTemplate(datasetType)} className="mt-2 text-zinc-700 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
          Download blank CSV template
        </button>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">2. Select file</p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            selectFile(e.dataTransfer.files[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded border-2 border-dashed p-8 text-center transition-colors ${
            isDragging ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-800/60" : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/40"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="text-sm">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">{file.name}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {file.type || "unknown type"} · {formatBytes(file.size)}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  selectFile(null);
                }}
                className="mt-2 text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Drag and drop a CSV or Excel file here, or <span className="underline">click to browse</span>
              <br />
              <span className="text-xs">Maximum {formatBytes(MAX_UPLOAD_BYTES)}</span>
            </p>
          )}
        </div>
        {fileError && (
          <div className="mt-2">
            <Banner tone="error">{fileError}</Banner>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          disabled={!file || pending !== null}
          onClick={handlePreview}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending === "preview" ? "Parsing…" : "Preview Import"}
        </button>
      </div>

      {previewResult && (
        <div className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">3. Preview</p>

          {previewResult.error || !previewSummary ? (
            <Banner tone="error">{previewResult.error ?? "Preview failed."}</Banner>
          ) : (
            <>
              <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <SummaryStat label="Rows detected" value={previewSummary.recordsRead} />
                  <SummaryStat label="Accepted" value={<span className="text-emerald-600 dark:text-emerald-400">{previewSummary.recordsAccepted}</span>} />
                  <SummaryStat
                    label="Rejected"
                    value={<span className={previewSummary.recordsRejected > 0 ? "text-red-600 dark:text-red-400" : ""}>{previewSummary.recordsRejected}</span>}
                  />
                  <SummaryStat label={previewSummary.fourthStatLabel} value={previewSummary.fourthStatValue} />
                </div>
                {previewSummary.captionLine && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{previewSummary.captionLine}</p>}
              </div>

              {previewResult.security && previewResult.security.sampleValid.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Sample rows (showing {previewResult.security.sampleValid.length} of {previewSummary.recordsAccepted} accepted)
                  </p>
                  <SecurityPreviewTable rows={previewResult.security.sampleValid} />
                </div>
              )}
              {previewResult.index && previewResult.index.sampleValid.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Sample rows (showing {previewResult.index.sampleValid.length} of {previewSummary.recordsAccepted} accepted)
                  </p>
                  <IndexPreviewTable rows={previewResult.index.sampleValid} />
                </div>
              )}
              {previewResult.financials && previewResult.financials.sampleValid.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Sample rows (showing {previewResult.financials.sampleValid.length} of {previewSummary.recordsAccepted} accepted)
                  </p>
                  <FinancialsPreviewTable rows={previewResult.financials.sampleValid} />
                </div>
              )}

              <RejectedRowsList errors={previewSummary.errors} />

              <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {previewSummary.recordsAccepted} valid record{previewSummary.recordsAccepted === 1 ? "" : "s"}
                  </span>{" "}
                  will be imported.{" "}
                  {previewSummary.recordsRejected > 0 && (
                    <span className="font-medium text-red-600 dark:text-red-400">
                      {previewSummary.recordsRejected} invalid row{previewSummary.recordsRejected === 1 ? "" : "s"}
                    </span>
                  )}
                  {previewSummary.recordsRejected > 0 && " will be skipped."}
                </p>
                <button
                  type="button"
                  disabled={!canConfirm || pending !== null}
                  onClick={handleConfirm}
                  className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-emerald-500"
                >
                  {pending === "commit" ? "Importing…" : "Confirm Import"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
