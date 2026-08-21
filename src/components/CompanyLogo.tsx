import Image from "next/image";
import { getCompanyLogo } from "@/lib/company-logo";

/**
 * A bounded, theme-safe company mark (M8 Part A.2 §17-19). Every logo
 * renders inside the same neutral white chip regardless of theme — several
 * source marks (e.g. MTN's) are dark strokes with no fill, which would
 * vanish against a dark page background otherwise; a uniform light
 * container avoids per-logo transparency judgment calls and keeps the row
 * visually consistent. Falls back to ticker initials (never a broken-image
 * icon) when no logo asset exists for the ticker (§18).
 */
export function CompanyLogo({ ticker, size = 28 }: { ticker: string | null | undefined; size?: number }) {
  const logo = getCompanyLogo(ticker);

  if (!logo) {
    const initials = (ticker ?? "?").slice(0, 4);
    return (
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 text-[9px] font-semibold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
      >
        {initials}
      </div>
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className="relative shrink-0 overflow-hidden rounded border border-zinc-200 bg-white p-1 dark:border-zinc-700"
    >
      <Image src={logo.src} alt="" fill sizes={`${size}px`} className="object-contain" />
    </div>
  );
}
