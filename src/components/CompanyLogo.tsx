import Image from "next/image";
import { getCompanyLogo, type LogoBackground } from "@/lib/company-logo";

const CHIP_CLASSES: Record<LogoBackground, string> = {
  light: "bg-white dark:bg-white",
  dark: "bg-zinc-900 dark:bg-black",
  brand: "",
};

/**
 * A bounded, theme-safe company mark (M8 Part A.2 §17-19, presentation
 * config expanded M8.2 Part B). Falls back to ticker initials (never a
 * broken-image icon) when no logo asset exists for the ticker (§18).
 *
 * Background defaults to a neutral light/white chip, which suits full-color
 * marks and dark-line-only marks alike. A logo can opt into "dark" (for a
 * mark supplied as solid white with no fill of its own) or "brand" (a
 * specific brand-color tile — reserved for marks whose identity depends on
 * that exact color pairing, e.g. MTN) via `company-logo.ts`.
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

  const background = logo.background ?? "light";

  return (
    <div
      style={background === "brand" ? { width: size, height: size, backgroundColor: logo.brandColor } : { width: size, height: size }}
      className={`relative shrink-0 overflow-hidden rounded border border-zinc-200 p-1 dark:border-zinc-700 ${CHIP_CLASSES[background]}`}
    >
      <Image src={logo.src} alt="" fill sizes={`${size}px`} className="object-contain" />
    </div>
  );
}
