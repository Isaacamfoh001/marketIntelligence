# Company/Security Logos — Source Provenance

Every file in this directory is a first-party brand asset (official site
favicon/apple-touch-icon or header logo) fetched directly from the issuer's
own domain and stored locally rather than hotlinked (CLAUDE.md §14/§21 —
avoid runtime dependence on external hosts; keep assets small and
optimized). None are third-party logo-aggregator copies.

A ticker with no row below has no sourced asset yet and falls back to
initials in `CompanyLogo.tsx` — most are suspended, thinly-traded, rights/
preference variants of an already-covered ordinary share, or small-cap
issuers whose official site could not be reached (bot-protected or
JS-rendered with no static icon) in this pass.

| File | Ticker(s) | Source URL |
|---|---|---|
| MTNGH.svg | MTNGH | mtn.com.gh (official mark, M8) |
| GOIL.png | GOIL | goil.com.gh (M8) |
| ADB.png | ADB | adb.com.gh (M8) |
| BOPP.png | BOPP | Benso Oil Palm Plantation official site (M8) |
| CAL.png | CAL, CALPREF, CALRT | calbank.net (M8; CALPREF/CALRT are CalBank's own preference/rights instruments) |
| TOTAL.png | TOTAL | TotalEnergies Marketing Ghana official site (M8) |
| AGA.svg | AGA, AADS | https://www.anglogoldashanti.com/wp-content/uploads/2025/09/logo-lion.svg (AADS is AngloGold Ashanti's own Ghana depositary-share line on the same equity) |
| ECOBANK.png | EGH, ETI | https://ecobank.com/img/eco/apple-touch-icon.png (Ecobank Ghana and Ecobank Transnational Incorporated share the group mark) |
| SCB.png | SCB, SCBPREF | https://av.sc.com/gh/content/images/content/images/cropped-512x512-1-200x200.png |
| KASA.png | KASA | https://kasapreko.com/storage/2024/05/cropped-KCL-Crown-Only-Transparent-180x180.png |
| TLW.svg | TLW | https://www.tullowoil.com/media/jr3gnvb3/logo-white.svg (white mark — rendered on a dark tile, see `company-logo.ts`) |
| UNIL.png | UNIL | https://www.unilever.com/apple-touch-icon.png |
| SOGEGH.svg | SOGEGH | https://societegenerale.com.gh/_assets/.../Icons/favicon-sg.svg |
| RBGH.png | RBGH | https://www.republicghana.com/wp-content/uploads/2018/04/cropped-favicon1-300x300.png |
| FAB.webp | FAB | https://www.firstatlanticbank.com.gh/apple-touch-icon.webp |
| EGL.png | EGL | https://myenterprisegroup.io/wp-content/uploads/fbrfg/apple-touch-icon.png |
| SIC.png | SIC | https://www.sic-gh.com/images/logo.png |
| ALLGH.webp | ALLGH | Atlantic Lithium official favicon, atlanticlithium.com.au (via Squarespace CDN) |
| CPC.png | CPC | https://cpc.com.gh/images/logo.png (resized locally, source was oversized) |
| DASPHARMA.png | DASPHARMA | https://dasplcgh.com/wp-content/uploads/2020/01/DASPharma-LogoNew.png |

## Not sourced this pass (M8.2)

- **GCB, FML (Fan Milk)** — official sites (gcbbank.com.gh, fanmilk.com) block
  simple HTTP fetches / serve JS-only shells; no static icon asset found.
- **ACCESS (Access Bank Ghana), GGBL (Guinness Ghana Breweries)** — official
  domains returned 403/connection errors.
- **ASG (Asante Gold)** — official site has no favicon or static header logo
  reachable without JS execution.
- **ZEN, TBL, ALW, SAMBA, GLD, PBC, CLYD, CMLT, MAC, MMH, HORDS, DIGICUT, IIL**
  — small-cap, thinly-traded, or suspended (PBC has been suspended from
  trading since Nov 2023); out of scope for this pass per CLAUDE.md's
  "do not spend excessive time on obscure/delisted instruments."
