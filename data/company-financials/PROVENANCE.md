# Company Financials — Source Provenance

Every file in this directory is a **derived, canonical dataset**: long-format
rows (Ticker/Period/FiscalYear/Metric/Value/Unit/Audited/StatementScope)
transcribed from a real official financial statement, ready to feed straight
into `scripts/import-company-financials.ts` (`--acquisition=OFFICIAL_WEB_FETCH`).
These CSVs are what makes a fresh database recoverable without re-fetching
anything — but they are not the source documents themselves. Full report PDFs
are not checked in (copyright; also unnecessary once the figures are
transcribed here).

The database's `IngestionRun.artifactName` records which of these files
supplied each observation; `CompanyFinancialObservation.reportedValue` /
`reportedUnit` preserve the statement's own printed figure and unit
alongside the normalized value. This file supplies the one piece current
schema doesn't carry per-row: the **exact source URL and page** each file's
figures were transcribed from.

## GOIL PLC (goil/)

Official source: `goil.com.gh` (robots.txt: `Allow: /`). All consolidated
(Group) + separate (Company) scope, HIGH_CONFIDENCE, audited.

| File | Source URL | Pages |
|---|---|---|
| GOIL-2020-Report-web.csv | https://goil.com.gh/wp-content/uploads/2021/06/GOIL-2020-Report-web.pdf | income statement / balance sheet |
| GOIL-2021.csv | https://goil.com.gh/wp-content/uploads/2022/06/GOIL-2021.pdf | income statement / balance sheet |
| Goil-2022.csv | https://goil.com.gh/wp-content/uploads/2023/06/Goil-2022.pdf | income statement / balance sheet |
| Goil-2023_Rport_Final.csv | https://goil.com.gh/wp-content/uploads/2024/06/Goil-2023_Rport_Final.pdf | income statement / balance sheet |
| GOIL-AGM-REPORT-2024.csv | https://goil.com.gh/wp-content/uploads/2025/07/GOIL-AGM-REPORT-2024.pdf | p.49 (income statement) / p.50 (balance sheet) |
| GOIL-Report_2025_web-1.csv | https://goil.com.gh/wp-content/uploads/2026/06/GOIL-Report_2025_web-1.pdf | p.45 (income statement) / p.46 (balance sheet) / p.67 (note 17, shares) |

2026 interim: not acquired — GOIL publishes no interim archive on its own
site; GSE's copy is off-limits (robots.txt).

## MTN Ghana / Scancom PLC (mtn/)

Official source: `mtn.com.gh`. FY2020/FY2021 are Group-only, summary-level
(REVIEW_REQUIRED — no EPS/DPS/shares available at that granularity).

| File | Source URL | Covers | Pages |
|---|---|---|---|
| SCANCOM-PLC-MTN-GHANA-2025-Financial-Report.csv | https://mtn.com.gh/wp-content/uploads/2026/03/SCANCOM-PLC-MTN-GHANA-2025-Financial-Report.pdf | FY2025 + FY2024 (restated comparative) | condensed statements |
| MTNGH-2023-Annual-Report-v.f.csv | https://mtn.com.gh/wp-content/uploads/2024/03/MTNGH-2023-Annual-Report-v.f.pdf | FY2023 + FY2022 (comparative) + FY2021/FY2020 (5-yr summary, p.140) | full statutory AR |

**FY2024 restatement**: MTN Ghana's FY2025 report explicitly restates FY2024
comparatives under IAS 8 (IFRS 16 lease-remeasurement correction). The
FY2024 rows here are the **restated** figures only — no pre-restatement
FY2024 statement was located. If a future source ever supplies a differing
FY2024 figure, treat it as a genuine restatement conflict, not a data error.

2026 interim: not acquired — MTN's investor-results page is JS-rendered and
its static dropdown doesn't reach 2026; H1 2025 URL was found but not
fetched (out of scope).

## ADB PLC — Agricultural Development Bank (adb/)

Official source: `agricbank.com`. Single-entity bank, one column (no
Group/Company split). Bank-metric profile (Operating Income, not Revenue).

| File | Source URL | Covers | Pages |
|---|---|---|---|
| ADB-Annual-Report-2024.csv | https://agricbank.com/wp-content/uploads/2025/09/Web_2024-ADB-Annual-Report-compressed-2.pdf | FY2024 | p.56 (income), p.57 (EPS), p.58 (balance sheet) |
| (FY2023/FY2022 comparative) | https://agricbank.com/wp-content/uploads/2024/07/2023-ADB-audited-Financial-Statements.pdf | FY2023 + FY2022 | p.44 (income), p.45 (EPS), p.46 (balance sheet) |

**Data-quality note**: ADB's own reports print EPS under a
"(in Ghana pesewas)" column header inconsistently — cross-validated against
two independently-fetched ADB reports (the FY2024 report's FY2023
comparative EPS of `-2.39` exactly equals the FY2023 report's own EPS of
`-238.89` pesewas ÷ 100), proving the header is a copy-paste holdover and
the values are genuinely GHS, not pesewas. Recorded here as PER_SHARE_GHS.

FY2020/FY2021 and 2026 interim: not acquired (not attempted — time-boxed
per M8 §4's "avoid excessive time on one issuer"; 3 years of clean,
cross-checked coverage was judged sufficient).

## CalBank PLC (cal/)

Official source: `calbank.net`. Bank profile. Annual coverage is
Group/CONSOLIDATED only (CalBank's own five-year summaries don't split
Bank-only figures annually); the H1 2026 interim uniquely reports both
Bank and Group columns, both included.

| File | Source URL | Covers | Pages |
|---|---|---|---|
| CalBank-Annual-Reports-2020-2025.csv | https://calbank.net/wp-content/uploads/2026/02/CalBank-PLC-2025-Annual-Report-FINAL_WEB.pdf | FY2021-2025 (five-year summary) | p.3 |
| CalBank-Annual-Reports-2020-2025.csv | https://calbank.net/wp-content/uploads/2026/01/CAL-Annual-Report-2021.pdf | FY2020 (five-year summary, cross-checked against FY2021 exactly) | p.3 |
| CalBank-H1-2026-Unaudited-Interim.csv | https://calbank.net/wp-content/uploads/2026/07/Unaudited-consolidated-June-2026.pdf | H1 2026 (Bank + Group), unaudited | p.1-2 |

FY2022/FY2023 negative equity and losses are real — reflects the sector-wide
2022-2023 Ghana domestic debt exchange (DDEP) impact on bank balance sheets,
not a data error.

## TOTAL — TotalEnergies Marketing Ghana PLC (total/)

Official source: `totalenergies.com.gh` (Shareholder Information page,
which links to Google-Drive-hosted PDFs — the referring page is the
official first-party pointer). Full Group (CONSOLIDATED) + Company
(SEPARATE) scope every year.

| File covers | Source URL (via totalenergies.com.gh/our-profile/shareholder-information/annual-reports) | Pages |
|---|---|---|
| FY2025 + FY2024 comparative | https://drive.google.com/file/d/1DH--ugJfZ2MreT9rDwZIBgYaj8Nkwk30/view | p.25 (SOFP), p.26 (SOPL) |
| FY2023 + FY2022 comparative | https://drive.google.com/file/d/120gsjb0ziqRWB4kYZ6itWWKAFKMb3dwk/view | p.27 (SOFP), p.28 (SOPL) |
| FY2022 + FY2021 comparative | https://drive.google.com/file/d/1BwSiFmAjSpDsr5w7e3O4wTI8HKCiW7tA/view | p.24 (SOFP), p.25 (SOPL) |
| FY2020 + FY2019 comparative | https://drive.google.com/file/d/1GTii-P8pnk-O-Lk5pwnS-kMg_67F7sUB/view | p.19 (SOFP), p.20 (SOPL) |

Legal name changed from "Total Petroleum Ghana PLC" (FY2020 report) to
"TotalEnergies Marketing Ghana PLC" (current) — same company/ticker (TOTAL).

2026 interim: not attempted (time-boxed).

## Acquisition method

Every observation from every file above is tagged
`acquisitionMethod=OFFICIAL_WEB_FETCH` on its `IngestionRun` — fetched
directly from a first-party official URL and transcribed into these
canonical rows, never scraped/parsed automatically from the PDF itself
(CLAUDE.md/M7.1 §39: no LLM/parser writes unreviewed values to production).
Retrieval timestamp: 2026-08-21 (see each `IngestionRun.startedAt` in
Data Centre for the exact time).
