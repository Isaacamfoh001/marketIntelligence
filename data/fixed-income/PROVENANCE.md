# Fixed Income Securities Master — Source Provenance (M7.1)

Both CSVs in this directory are **derived, canonical datasets**, ready to
feed straight into `npm run import:fixed-income-securities -- --file=...
--commit` (or the Data Centre Import Wizard). They transcribe the
contractual identity (issuer, ISIN, coupon, maturity) of real, currently
outstanding Ghana Fixed Income Market (GFIM) securities — never synthetic
or estimated data.

## Source

**Institution:** Ghana Fixed Income Market (GFIM) — a joint initiative of
the Bank of Ghana, Ghana Stock Exchange, Central Securities Depository
Ghana, and other market participants.

**Pages read (2026-10-04):**

- Government bonds: `https://gfim.com.gh/active-security/` ("Active
  Securities (Bonds)")
- Corporate bonds: `https://gfim.com.gh/active-corporate-bonds/` ("Active
  Corporate Bond")

Both pages publish a live table (SECURITY DESCRIPTION, ISIN, NAME, ISSUE
DATE, MATURITY, ISSUER CODE, COUPON/INTEREST RATE, DAYS TO MATURITY,
CURRENCY TYPE) rendered client-side via a WordPress table plugin whose
underlying AJAX/data-loading contract is undocumented (no stable public
API). Reverse-engineering that contract for unattended automated
ingestion would be exactly the kind of brittle scraping CLAUDE.md §7
warns against — so these pages are **Mode C (manual transcription)**:
every row below was read directly off the live, rendered page (via an
exact text extraction of the DOM, not a summarization) and transcribed
verbatim into this template. GFIM's own robots.txt does not block
automated fetches of these specific URLs, but the lack of a stable,
documented data contract is the reason this stays Mode C rather than
Mode A.

## Issuer code → legal name (verified via independent sources)

| Code | Issuer | Evidence |
|---|---|---|
| GOG | Government of Ghana | self-evident from GFIM's own "Active Securities (Bonds)" page title |
| BFS | Bayport Savings and Loans PLC | GFIM press release `PR. 004/2019-BAYPORT SAVINGS AND LOANS PLC LISTING OF BFS10-3Y21...`, multiple news reports on Bayport's GFIM bond programme |
| KCP | Kasapreko Company PLC | news coverage of Kasapreko's GH¢600m GFIM note programme (Series 1/2), cross-confirmed by the exact coupon/maturity match (26% due 29/01/2027) against Kasapreko's own press coverage |
| LGH | Letshego Ghana Savings and Loans Plc | multiple news reports on Letshego Ghana's GFIM bond issuances |
| ILL | Izwe Savings and Loans Plc | GFIM press release `PR. 474/2018 IZWE LOANS LIMITED LISTING OF A NEW SERIES (DEBT)...` |
| CMB | Ghana Cocoa Board (COCOBOD) | news coverage explicitly naming COCOBOD's CMB-coded GFIM bonds |
| DTP | Daakye Trust Plc | news/market coverage identifying DTP as Daakye Trust Plc's GFIM ticker |
| QTL | Quantum Terminal Plc | news coverage of Quantum Terminal's GFIM listing |
| AFB | afb Ghana (microfinance; subsequently acquired by Letshego Holdings Limited) | news coverage of afb Ghana / Letshego Holdings |

## What was excluded, and why

- **2 government bonds** (ISINs `GHGGOG061383`, `GHGGOG064254`) — GFIM's
  own COUPON/INTEREST RATE column shows "-" (not published). Never
  imported with a fabricated or assumed rate; excluded until GFIM
  publishes one.
- **1 corporate bond** (Letshego Ghana, ISIN `GHCLGH075751`) — same
  reason, coupon shown as "-".
- **2 Bayport floating-rate notes** (ISINs `GHCBFS070281`, `GHCBFS071966`)
  — both matured (28/03/2025 and 19/09/2025 respectively) before this
  import date (2026-10-04); a matured instrument isn't part of the
  currently outstanding universe. Bayport's remaining active securities
  (6 bonds) are all FIXED rate, so the platform's YTM engine (which does
  not support floating-rate instruments — see CLAUDE.md M7 §7) applies to
  100% of Bayport's current portfolio without any gap.

## Coupon frequency

Column `Coupon Frequency` is set to `SEMI_ANNUAL` for every row. This was
independently verified for three of the issuers in this set (not assumed
market-wide without evidence):

- **Government of Ghana bonds**: "Government of Ghana bonds make interest
  payments semi-annually from the issue date" — CSD Ghana prospectus for a
  GoG 5-Year Fixed Rate Bond.
- **Kasapreko**: "bi-annual coupon payment cycles" confirmed via Kasapreko's
  own bond-programme press coverage (Tranche 1: 26 Jan/26 Jul cycle;
  Tranche 2: every 182 days) — both bi-annual.
- **Bayport** (M7.2): independently confirmed per-ISIN via cbonds.com's
  issue-level terms ("interest paid 2 times a year to holders") for 2 of
  Bayport's 6 currently active fixed-rate ISINs — `GHCBFS072253` (23.5%,
  17 Oct 2026) and `GHCBFS063609` (21.55%, 25 Jun 2026). cbonds.com's bond
  pages themselves return HTTP 403 to automated fetch (consistent with
  this platform's policy of never bypassing a technical access control —
  CLAUDE.md §7), so this was read from cbonds' own indexed search-result
  metadata, not a reverse-engineered or authenticated request. The
  remaining 4 active Bayport ISINs (`GHCBFS071974`, `GHCBFS075173`,
  `GHCBFS075165`, `GHCBFS075934`) are all notes issued under the same
  GHS 500m Medium Term Notes and Bond Programme (see Bayport's 6 April
  2023 GSE press release) and are assumed to follow the same semi-annual
  convention as their 2 verified siblings — not independently verified
  per-ISIN. A programme-level term sheet, if obtained later, could verify
  the remaining 4 in one step since a programme typically fixes the
  payment convention across its series.

No authoritative evidence was found of a different payment frequency for
any other issuer in this set (AFB/CMB/DTP/ILL/LGH/QTL); semi-annual is
applied as the GFIM corporate-bond market's general convention based on
the confirmed cases above, not independently verified per issuer. If a
specific issuer's term sheet is later found to use a different frequency,
correct that row and re-import — the import is idempotent (upserts by
`instrument_code`, i.e. ISIN).

## Why `instrument_code` is the ISIN, not GFIM's own "SECURITY DESCRIPTION"

GFIM's own description strings embed the maturity date with inconsistent
formatting (e.g. `BFS-BD-19/0926-C2851` is missing a `/` in the date) and
contain `/` characters the platform's instrument-code validation rejects
(`^[A-Z0-9][A-Z0-9._-]{0,39}$`). The ISIN is the authoritative,
internationally standardised unique identifier GFIM itself publishes for
every security, so it is used directly as both `Instrument Code` and
`ISIN` — the cleaner, more stable choice, not a Korbly-invented scheme.

## No market observations (price/yield) in this import

This CSV supplies ONLY contractual identity (the Securities Master). No
`fixed-income-observations` import accompanies it: GFIM's own daily/
monthly trading reports (which would carry real secondary-market traded
prices/yields) are served through a WordPress media-library plugin
(FileBird) with no stable public download URL or documented API —
pursuing that further would mean probing undocumented admin REST routes,
which was deliberately not done (see M7.1 completion report, "Known Data
Gaps"). Every security imported from this file will therefore show YTM/
duration as "No market observation" until a real price or yield is
imported — this is the financially honest state, not a bug: GFIM's
COUPON/INTEREST RATE column is the bond's contractual coupon, and must
never be imported as if it were a market yield (CLAUDE.md: "never
substitute coupon for expected return").
