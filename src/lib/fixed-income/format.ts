// ---------------------------------------------------------------------------
// Display formatting shared by every Fixed Income surface (M7.3 §7). Pure
// string helpers — no financial calculation lives here. Centralised so the
// landing page, Compare, and Security Detail label time remaining, spreads
// and security names identically.
// ---------------------------------------------------------------------------

const ISSUER_SUFFIXES = [" Savings and Loans", " Company", " PLC", " Plc", " Limited", " Ltd"];

/** Short issuer name for dense tables ("Bayport Savings and Loans PLC" → "Bayport"); the full legal name stays available alongside. */
export function issuerShortName(issuerName: string): string {
  if (/^government of ghana$/i.test(issuerName.trim())) return "GoG";
  let cut = issuerName.length;
  for (const suffix of ISSUER_SUFFIXES) {
    const i = issuerName.indexOf(suffix);
    if (i > 0 && i < cut) cut = i;
  }
  return issuerName.slice(0, cut).trim();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Bayport 23.50% Jul-27" — the human-readable identity of a bond, so instrument codes can be secondary metadata. */
export function securityShortLabel(issuerName: string, couponRatePct: number | null, maturityDateIso: string): string {
  const d = new Date(`${maturityDateIso}T00:00:00.000Z`);
  const maturity = `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
  const coupon = couponRatePct !== null ? ` ${couponRatePct.toFixed(2)}%` : "";
  return `${issuerShortName(issuerName)}${coupon} ${maturity}`;
}

export function formatIsoDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Remaining life in the unit an analyst would say out loud: days inside ~3 months, months inside 2 years, years beyond. */
export function formatTimeRemaining(days: number): string {
  if (days <= 0) return "Matured";
  if (days === 1) return "1 day";
  if (days <= 92) return `${days} days`;
  if (days < 730) return `~${Math.round(days / 30.4375)} months`;
  return `~${(days / 365.25).toFixed(1)} years`;
}

export function formatPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatBps(bps: number): string {
  return `${bps >= 0 ? "+" : ""}${bps} bps`;
}

/** Signed tenor difference, e.g. "+212d" / "−1.4y". */
export function formatTenorDiff(days: number): string {
  const sign = days > 0 ? "+" : days < 0 ? "−" : "±";
  const abs = Math.abs(days);
  return abs < 365 ? `${sign}${abs}d` : `${sign}${(abs / 365.25).toFixed(1)}y`;
}

export function formatGhs(value: number): string {
  return `GHS ${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
