#!/usr/bin/env node
// ---------------------------------------------------------------------------
// GSE Market Summary — index (GSE-CI/GSE-FSI) & whole-market import CLI.
//
// Same manual-import rationale as import-gse-security-prices.ts. Two-stage
// workflow — preview by default, --commit persists:
//
//   npm run import:gse-market-summary -- --file=./market-summary.csv
//   npm run import:gse-market-summary -- --file=./market-summary.csv --commit
//   npm run import:gse-market-summary -- --file=./monthly.csv --kind=monthly-report --commit
//
// --kind=daily (default) is a genuinely daily feed; --kind=monthly-report
// is for month-end snapshots extracted from GSE's official monthly Market
// Summary PDF reports (M8.1) — kept as a separate, lower-priority,
// honestly-labeled source rather than mislabeled as daily (see
// gse-index-provider.ts header).
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { importGseMarketSummary, type IndexImportKind } from "../src/lib/ingestion/gse-index-provider.js";

function parseArgs(argv: string[]): { file: string; kind: IndexImportKind; commit: boolean } {
  let file: string | undefined;
  let kind: IndexImportKind = "daily";
  let commit = false;

  for (const arg of argv) {
    if (arg.startsWith("--file=")) file = arg.slice("--file=".length);
    else if (arg.startsWith("--kind=")) {
      const value = arg.slice("--kind=".length);
      if (value !== "daily" && value !== "monthly-report") {
        console.error(`Invalid --kind: "${value}" — expected "daily" or "monthly-report"`);
        process.exit(1);
      }
      kind = value;
    } else if (arg === "--commit") commit = true;
  }

  if (!file) {
    console.error("Usage: npm run import:gse-market-summary -- --file=<path.csv|.xlsx> [--kind=daily|monthly-report] [--commit]");
    console.error("Without --commit, the file is parsed and validated only — nothing is persisted.");
    process.exit(1);
  }

  return { file, kind, commit };
}

async function main() {
  const { file, kind, commit } = parseArgs(process.argv.slice(2));

  const absolutePath = path.resolve(file);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(absolutePath);
  const filename = path.basename(absolutePath);

  const result = await importGseMarketSummary(filename, buffer, kind, { commit });

  console.log("");
  console.log(`Mode:                ${commit ? "COMMIT" : "PREVIEW (no data persisted — pass --commit to import)"}`);
  console.log(`Source:              Ghana Stock Exchange — ${kind === "daily" ? "Daily" : "Monthly"} Market Summary${kind === "daily" ? "" : " Reports"}`);
  console.log(`File:                ${filename}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Trading date range:  ${result.earliestTradingDate ?? "—"} → ${result.latestTradingDate ?? "—"}`);
  if (commit) {
    console.log(`Index observations:  ${result.indexObservationsPersisted} (${result.inserted} new, ${result.updated} updated)`);
    console.log(`Market summaries:    ${result.summariesPersisted}`);
    console.log(`Run status:          ${result.status}`);
    console.log(`Run ID:              ${result.runId ?? "—"}`);
  }

  if (result.errors.length > 0) {
    console.log("");
    console.log(`Rejected rows (${result.errors.length}, showing up to 10):`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  Row ${err.rowNumber}: ${err.errors.join("; ")}`);
    }
  }
  console.log("");

  if (commit && result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
