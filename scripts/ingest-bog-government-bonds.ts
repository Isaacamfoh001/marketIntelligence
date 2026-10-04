#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bank of Ghana Government Notes & Bonds (Auction) ingestion CLI (M7.1 §7).
// Mode A automated — reuses the same proven endpoint as ingest-bog-
// treasury.ts. No --commit flag: this is a read-and-persist collector like
// the other BoG CLIs, not a file preview/commit workflow.
//
//   npm run ingest:bog-government-bonds
// ---------------------------------------------------------------------------

import "dotenv/config";
import { ingestBogGovernmentBonds } from "../src/lib/ingestion/bog-government-bonds-provider.js";

async function main() {
  const result = await ingestBogGovernmentBonds();

  console.log("");
  console.log("Source:              Bank of Ghana — Government Notes & Bonds (Auction)");
  console.log(`Rows read:           ${result.recordsRead}`);
  console.log(`Accepted (recent):   ${result.recordsAccepted}`);
  console.log(`Rejected/stale:      ${result.recordsRejected}`);
  console.log(`Persisted:           ${result.inserted + result.updated} (${result.inserted} new, ${result.updated} updated)`);
  console.log(`Run status:          ${result.status}`);
  console.log(`Run ID:              ${result.runId}`);

  if (result.securities.length > 0) {
    console.log("");
    console.log("Securities:");
    for (const s of result.securities) {
      console.log(`  ${s.instrumentCode} — ${s.tenorYears}Y, ${s.ratePct}%, auctioned ${s.observationDate}`);
    }
  }
  console.log("");

  if (result.status !== "SUCCESS") process.exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
