// ---------------------------------------------------------------------------
// Workspace charts (M9.0). Plain SVG / CSS — no chart library, no client JS —
// because each one answers a single question and the exact figures are always
// printed beside the shape. Colour is never the only signal.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { ContributionBar } from "@/lib/decision-insights";
import type { MaturityProfile } from "@/lib/decision-insights";

export interface DonutSlice {
  key: string;
  label: string;
  pct: number;
  valueText: string;
  color: string;
}

/** "What is this portfolio made of?" — composition. The legend carries every figure; the ring is the shape. */
export function Donut({ slices, centerLabel, centerValue }: { slices: DonutSlice[]; centerLabel: string; centerValue: string }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const GAP = slices.length > 1 ? 2 : 0;
  const offsets = slices.map((_, i) => slices.slice(0, i).reduce((sum, x) => sum + (x.pct / 100) * C, 0));
  const summary = slices.map((s) => `${s.label} ${s.pct.toFixed(0)}%`).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label={`Asset mix: ${summary}`}>
          <circle cx="70" cy="70" r={R} fill="none" strokeWidth="20" className="stroke-zinc-100 dark:stroke-zinc-800" />
          {slices.map((s, i) => {
            const len = Math.max(0, (s.pct / 100) * C - GAP);
            return <circle key={s.key} cx="70" cy="70" r={R} fill="none" strokeWidth="20" stroke={s.color} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offsets[i]} />;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{centerLabel}</span>
          <span className="text-base font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{centerValue}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300">{s.label}</span>
            <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{s.valueText}</span>
            <span className="w-12 text-right font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{s.pct.toFixed(s.pct >= 10 ? 0 : 1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface RankedRow {
  key: string;
  label: string;
  sub?: string;
  /** Bar length basis (any positive measure). */
  magnitude: number;
  valueText: string;
  detailText?: string;
  color: string;
  href?: string;
}

/** "Which holdings or issuers dominate?" — ranked horizontal bars, longest first. */
export function RankedBars({ rows, ariaLabel }: { rows: RankedRow[]; ariaLabel: string }) {
  const max = Math.max(...rows.map((r) => r.magnitude), 0);
  return (
    <ol className="space-y-3" aria-label={ariaLabel}>
      {rows.map((r) => {
        const label = (
          <span className="min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {r.label}
            {r.sub && <span className="ml-1.5 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{r.sub}</span>}
          </span>
        );
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3">
              {r.href ? (
                <Link href={r.href} className="min-w-0 rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                  {label}
                </Link>
              ) : (
                label
              )}
              <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{r.valueText}</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
              <div className="korbly-grow h-full rounded-full" style={{ width: `${max > 0 ? Math.max(2, (r.magnitude / max) * 100) : 0}%`, background: r.color }} />
            </div>
            {r.detailText && <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{r.detailText}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** "When does capital come due?" — contractual principal by remaining life. */
export function MaturityColumns({ profile, formatGhs }: { profile: MaturityProfile; formatGhs: (n: number) => string }) {
  const max = Math.max(...profile.buckets.map((b) => b.nominalGhs), 0);
  return (
    <ul className="grid grid-cols-5 gap-2" aria-label="Principal by time to maturity">
      {profile.buckets.map((b, i) => (
        <li key={b.key} className="flex min-w-0 flex-col items-center">
          <span className="h-4 text-[11px] font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{b.nominalGhs > 0 ? formatGhs(b.nominalGhs) : ""}</span>
          <div className="flex h-28 w-full items-end justify-center" aria-hidden>
            <div className="korbly-rise w-full max-w-10 rounded-t-md" style={{ height: `${max > 0 && b.nominalGhs > 0 ? Math.max(4, (b.nominalGhs / max) * 100) : 2}%`, background: i === 0 ? "var(--c-bill)" : "var(--c-gov)", opacity: b.nominalGhs > 0 ? 1 : 0.25 }} />
          </div>
          <span className="mt-1.5 text-center text-[11px] leading-tight text-zinc-600 dark:text-zinc-300">{b.label}</span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{b.positionCount > 0 ? `${b.positionCount} ${b.positionCount === 1 ? "holding" : "holdings"}` : "none"}</span>
        </li>
      ))}
    </ul>
  );
}

/** "What caused the gain or loss?" — zero-centred contribution bars. The signed amount is always printed. */
export function ContributionChart({ rows, ariaLabel, other }: { rows: ContributionBar[]; ariaLabel: string; other?: { count: number; impactText: string; impactGhs: number } | null }) {
  const all = [...rows.map((r) => r.impactGhs), other?.impactGhs ?? 0];
  const max = Math.max(...all.map(Math.abs), 0);
  const line = (key: string, label: string, sub: string, value: number, text: string, share: number | null, href?: string) => {
    const w = max === 0 ? 0 : Math.max(1.5, (Math.abs(value) / max) * 50);
    return (
      <li key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)_7.5rem]">
        <div className="min-w-0">
          {href ? (
            <Link href={href} className="block truncate text-sm font-medium text-zinc-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-zinc-100">
              {label}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
          )}
          <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</p>
        </div>
        <p className="row-start-1 text-right text-sm font-semibold tabular-nums sm:col-start-3 sm:row-start-1" style={{ color: value === 0 ? undefined : value < 0 ? "var(--c-loss)" : "var(--c-gain)" }}>
          {text}
          {share !== null && <span className="ml-1 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">{share.toFixed(0)}%</span>}
        </p>
        <div className="relative col-span-2 h-3 rounded-sm bg-zinc-100 dark:bg-zinc-800 sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-hidden>
          <div className="absolute inset-y-[-3px] left-1/2 w-px bg-zinc-400 dark:bg-zinc-500" />
          {value !== 0 && <div className="korbly-grow absolute inset-y-0 rounded-sm" style={{ width: `${w}%`, left: value < 0 ? `${50 - w}%` : "50%", background: value < 0 ? "var(--c-loss)" : "var(--c-gain)", transformOrigin: value < 0 ? "right center" : "left center" }} />}
        </div>
      </li>
    );
  };
  return (
    <ul className="space-y-3.5" aria-label={ariaLabel}>
      {rows.map((r) => line(r.id, r.label, r.sublabel, r.impactGhs, r.impactText, r.sharePct, r.positionId ? `?view=holdings&position=${r.positionId}#inspect` : undefined))}
      {other && other.count > 0 && line("other", `${other.count} other ${other.count === 1 ? "holding" : "holdings"}`, "Smaller impacts, combined", other.impactGhs, other.impactText, null)}
    </ul>
  );
}
