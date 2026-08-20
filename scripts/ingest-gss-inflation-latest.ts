#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ghana Statistical Service — CPI Latest Release ingestion CLI.
//
// Semi-automated/manual entry, not a scraper: see gss-cpi-provider.ts for
// why GSS's current latest-release surface (homepage banner image,
// client-rendered SPA, unpredictable PDF filenames) has no reliable
// automated path today. An analyst reads the official release
// (https://statsghana.gov.gh/highlights/inflation-rate or the monthly
// bulletin) and enters the reference month + headline YoY rate here;
// this still runs through the full validate/persist/provenance pipeline
// — nothing is hardcoded into UI/query code.
//
// Usage:
//   npm run ingest:gss-inflation-latest -- --observations=2026-06:5.3,2026-07:4.6
//   npm run ingest:gss-inflation-latest -- --observations=2026-07:4.6 --sourceUrl="https://statsghana.gov.gh/highlights/inflation-rate"
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ingestGssInflationLatestRelease } from "../src/lib/ingestion/gss-cpi-provider.js";

function parseArgs(argv: string[]): { observations: { referenceMonth: string; headlineYoy: number }[]; sourceUrl?: string } {
  let observationsArg: string | undefined;
  let sourceUrl: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--observations=")) observationsArg = arg.slice("--observations=".length);
    else if (arg.startsWith("--sourceUrl=")) sourceUrl = arg.slice("--sourceUrl=".length);
  }

  if (!observationsArg) {
    console.error("Usage: npm run ingest:gss-inflation-latest -- --observations=YYYY-MM:VALUE[,YYYY-MM:VALUE...] [--sourceUrl=URL]");
    console.error('Example: npm run ingest:gss-inflation-latest -- --observations=2026-06:5.3,2026-07:4.6');
    process.exit(1);
  }

  const observations = observationsArg.split(",").map((pair) => {
    const [referenceMonth, valueText] = pair.split(":");
    return { referenceMonth: (referenceMonth ?? "").trim(), headlineYoy: Number((valueText ?? "").trim()) };
  });

  return { observations, sourceUrl };
}

async function main() {
  const { observations, sourceUrl } = parseArgs(process.argv.slice(2));
  const result = await ingestGssInflationLatestRelease(observations, sourceUrl);

  console.log("");
  console.log("Source:              Ghana Statistical Service — CPI Latest Release");
  console.log("Series:               Headline Inflation YoY");
  console.log(`Latest:              ${result.latest ?? "—"}`);
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted:            ${result.recordsAccepted}`);
  console.log(`Rejected:            ${result.recordsRejected}`);
  console.log(`Inserted/Updated:    ${result.persisted}`);
  console.log(`Run status:          ${result.status}`);
  console.log(`Run ID:              ${result.runId}`);

  if (result.errors.length > 0) {
    console.log("");
    console.log("Rejection details:");
    for (const err of result.errors) {
      console.log(`  ${JSON.stringify(err.row)}: ${err.errors.join("; ")}`);
    }
  }
  console.log("");

  if (result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
