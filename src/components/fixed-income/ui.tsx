// ---------------------------------------------------------------------------
// Small presentational pieces shared by every Fixed Income surface (M7.3
// §24): one definition of the observation/freshness/lifecycle badges and
// section chrome, so a "Secondary" or "Stale" tag means the same thing and
// looks the same on the landing page, Compare, and Security Detail.
// No hooks — usable from server and client components alike.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { formatIsoDate, issuerShortName, securityShortLabel, type SecurityLifecycle } from "@/lib/fixed-income";

export const TH = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400";
export const TD = "whitespace-nowrap px-3 py-2";
export const NUM = "whitespace-nowrap px-3 py-2 text-right tabular-nums";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>{children}</div>;
}

export function SectionHeading({ title, question, right }: { title: string; question?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h2>
        {question && <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{question}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, emphasis = false }: { label: string; value: React.ReactNode; sub?: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-0.5 tabular-nums text-zinc-900 dark:text-zinc-100 ${emphasis ? "text-2xl font-semibold" : "text-base font-semibold"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{sub}</div>}
    </div>
  );
}

const PILL = "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap";

export function ObservationKindBadge({ kind }: { kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null }) {
  if (!kind) return null;
  return kind === "AUCTION_PRIMARY" ? (
    <span className={`${PILL} bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400`}>Primary</span>
  ) : (
    <span className={`${PILL} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>Secondary</span>
  );
}

export function FreshnessBadge({ freshness }: { freshness: "CURRENT" | "STALE" | "MISSING" }) {
  if (freshness === "STALE") return <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>Stale</span>;
  if (freshness === "CURRENT") return <span className={`${PILL} bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400`}>Recent</span>;
  return null;
}

export function LifecycleBadge({ lifecycle }: { lifecycle: SecurityLifecycle }) {
  if (lifecycle === "MATURING_SOON") return <span className={`${PILL} bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400`}>Maturing soon</span>;
  if (lifecycle === "MATURED") return <span className={`${PILL} bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}>Matured</span>;
  return null;
}

export function HypotheticalBadge() {
  return <span className={`${PILL} border border-dashed border-violet-300 text-violet-700 dark:border-violet-700 dark:text-violet-300`}>Hypothetical</span>;
}

/** Observation cell: date + kind + freshness, or an explicit "No market quote" — never a bare dash. */
export function ObservationCell({ dateIso, kind, freshness, align = "right" }: { dateIso: string | null; kind: "AUCTION_PRIMARY" | "SECONDARY_MARKET" | null; freshness: "CURRENT" | "STALE" | "MISSING"; align?: "left" | "right" }) {
  if (!dateIso) return <span className="text-xs text-zinc-400 dark:text-zinc-500">No market quote</span>;
  return (
    <div className={`flex flex-col gap-0.5 ${align === "right" ? "items-end" : "items-start"}`}>
      <span className="text-xs text-zinc-700 dark:text-zinc-300">{formatIsoDate(dateIso)}</span>
      <span className="flex gap-1">
        <ObservationKindBadge kind={kind} />
        <FreshnessBadge freshness={freshness} />
      </span>
    </div>
  );
}

/** Security identity with the human label primary and the instrument code as secondary metadata (M7.3 §7). */
export function SecurityIdentity({ instrumentCode, issuerName, couponRatePct, maturityDate, href = true }: { instrumentCode: string; issuerName: string; couponRatePct: number | null; maturityDate: string; href?: boolean }) {
  const label = securityShortLabel(issuerName, couponRatePct, maturityDate);
  return (
    <div className="min-w-0 max-w-[13rem]">
      {href ? (
        <Link href={`/fixed-income/${encodeURIComponent(instrumentCode)}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
          {label}
        </Link>
      ) : (
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
      )}
      <div className="truncate text-[11px] text-zinc-400 dark:text-zinc-500" title={`${issuerName} · ${instrumentCode}`}>
        {issuerShortName(issuerName) !== issuerName ? `${issuerName} · ` : ""}
        <span className="font-mono">{instrumentCode}</span>
      </div>
    </div>
  );
}

/** A missing value with its reason as a tooltip — concise in the cell, explicit on hover (M7.3 §21). */
export function Missing({ reason, short = "—" }: { reason: string; short?: string }) {
  return (
    <span className="cursor-help text-zinc-400 dark:text-zinc-500" title={reason}>
      {short}
    </span>
  );
}

export function signedTone(value: number): string {
  return value < 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100";
}
