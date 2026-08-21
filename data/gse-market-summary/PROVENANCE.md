# GSE Monthly Market Summary — Source Provenance

`gse-market-summary-monthly.csv` is a **derived, canonical dataset**: one
row per reporting month, transcribed directly from each official GSE
monthly Market Summary PDF report's own headline summary table (GSE-CI,
GSE-FSI where published, market capitalization, total volume traded, total
value traded), ready to feed straight into
`scripts/import-gse-market-summary.ts --kind=monthly-report`.

This is what makes a fresh database recoverable without re-reading the PDFs
— but it is not the source documents themselves. The 19 official report
PDFs are not checked in (copyright; also unnecessary once the figures are
transcribed here). All 19 were supplied by the user directly from
`gse.com.gh` monthly market report downloads.

The database's `IngestionRun.artifactName` records
`gse-market-summary-monthly.csv` as the file that supplied every row in
this import; this file supplies the one piece the schema doesn't carry —
the exact **source report filename** each month's figures were transcribed
from, and which table on that report was read.

Every figure below was read from the report's own **headline summary
table on page 1** (GSE-CI / GSE-FSI level, market capitalization, total
volume, total value traded — the "as at month-end" figures, never a
month-over-month change or percentage). Units: market capitalization is
published as GH₵ millions and scaled ×1,000,000 into GHS in the CSV;
volume is shares; value is GHS.

## Month → source file map

| Reporting month (month-end) | Source file | Page |
|---|---|---|
| 2025-01-31 | GSE-Monthly-Summary-January-2025.pdf | 1 |
| 2025-02-28 | GSE-MONTHLY-SUMMARY-FEBRUARY-2025.pdf | 1 |
| 2025-03-31 | GSE-MONTHLY-SUMMARY-MARCH-2025.pdf | 1 |
| 2025-04-30 | GSE-MONTHLY-SUMMARY-APRIL-2025.pdf | 1 |
| 2025-05-31 | GSE-MONTHLY-SUMMARY-MAY-2025.pdf | 1 |
| 2025-06-30 | GSE-MONTHLY-SUMMARY-JUNE-2025.pdf | 1 |
| 2025-07-31 | GSE-MONTHLY-SUMMARY-JULY-2025.pdf | 1 |
| 2025-08-31 | GSE-Monthly-Summary-August-2025.pdf | 1 |
| 2025-09-30 | GSE-MARKET-SUMMARY-SEPTEMBER2025.pdf | 1 |
| 2025-10-31 | GSE-MONTHLY-SUMMARY-OCTOBER2025.pdf | 1 |
| 2025-11-30 | GSE-Monthly-Market-Summary-Report-November-2025.pdf.pdf | 1 |
| 2025-12-31 | GSE-Market-Summary-Full-Year-2025.pdf | 1 (December column of the full-year summary table) |
| 2026-01-31 | GSE-MARKET-SUMMARY-JANUARY-2026.pdf.pdf | 1 |
| 2026-02-28 | GSE-Market-Summary-February-2026.pdf.pdf | 1 |
| 2026-03-31 | GSE-MARKET-SUMMARY-MARCH-2026.pdf | 1 |
| 2026-04-30 | GSE-Market-Summary-April-2026.pdf.pdf | 1 |
| 2026-05-31 | GSE-May-Market-Summary-Report.pdf.pdf | 1 |
| 2026-06-30 | GSE-June-Market-Summary-2026.pdf | 1 |
| 2026-07-31 | GSE-July-Market-Summary-2026.pdf.pdf | 1 |

## GSE-FSI availability

GSE-FSI (Financial Stocks Index) is only published in these reports
starting with the June 2025 report; no earlier report in this set carries a
GSE-FSI figure at all. Months before June 2025 are left blank (not zero,
not omitted) in the CSV — the importer treats a blank GSE-FSI cell as "not
observed this month," never as a zero index level.

## Cross-validation method

Each report's own comparative mini-table (showing the prior month's
GSE-CI/GSE-FSI/market-cap figures alongside the current month, for
month-over-month context) was used to independently corroborate the
immediately-preceding month's directly-extracted figures. This produced a
near-complete overlapping chain of confirmation across all 19 months, with
one minor internal inconsistency found and resolved via a third
independent corroborating figure from the same report set.

## Extraction method

Deterministic: each report's page 1 was read as a rendered page image (no
OCR, no ML transcription) and the headline table's own printed figures
were transcribed directly — never a percentage-change column, never a
prior-month comparative column mistaken for the current month.
