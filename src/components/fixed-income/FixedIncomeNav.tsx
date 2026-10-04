"use client";

// ---------------------------------------------------------------------------
// Fixed Income local navigation (M7.3.2 §2) — the three layers of the
// product as three real routes, shallow to deep:
//   Intelligence (what is happening / what deserves attention)
//   Compare & Scenarios (analysis: returns at hypothetical prices, comparables)
//   Market (evidence: the full securities universe and reliable yields)
// A security page is the deepest drill-down and appears as a trailing crumb.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/fixed-income", label: "Intelligence" },
  { href: "/fixed-income/compare", label: "Compare & Scenarios" },
  { href: "/fixed-income/market", label: "Market" },
] as const;

export function FixedIncomeNav({ securityLabel, asOf }: { securityLabel?: string; asOf?: string }) {
  const pathname = usePathname();
  return (
    <div className="-mt-1 mb-2 flex flex-wrap items-end justify-between gap-2 border-b border-zinc-200 dark:border-zinc-800">
      <nav aria-label="Fixed Income" className="flex flex-wrap items-end gap-1 text-sm">
        <span className="mr-2 pb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Fixed Income</span>
        {TABS.map((t) => {
          const active = t.href === "/fixed-income" ? pathname === "/fixed-income" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-2.5 pb-2 pt-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${
                active
                  ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        {securityLabel && (
          <span aria-current="page" className="-mb-px border-b-2 border-zinc-900 px-2.5 pb-2 pt-1 font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-100">
            <span className="text-zinc-400 dark:text-zinc-500">Security · </span>
            {securityLabel}
          </span>
        )}
      </nav>
      {asOf && <span className="pb-2 text-xs text-zinc-400 dark:text-zinc-500">Analytics as of {asOf}</span>}
    </div>
  );
}
