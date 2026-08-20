"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/macro-rates", label: "Macro & Rates" },
  { href: "/equities", label: "Equities" },
  { href: "/companies", label: "Companies" },
  { href: "/data-centre", label: "Data Centre" },
] as const;

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`block px-4 py-1.5 text-sm transition-colors ${
              isActive
                ? "bg-zinc-200 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function Sidebar({
  mobileOpen = false,
  onNavigate,
}: {
  mobileOpen?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: permanent sidebar */}
      <nav className="hidden w-48 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 py-3 dark:border-zinc-800 dark:bg-zinc-900 md:flex">
        <NavLinks pathname={pathname} />
      </nav>

      {/* Mobile: drawer + backdrop, shown only when toggled open */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-zinc-900/40"
            onClick={onNavigate}
          />
          <nav className="absolute inset-y-0 left-0 flex w-56 flex-col border-r border-zinc-200 bg-white py-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
            <NavLinks pathname={pathname} onNavigate={onNavigate} />
          </nav>
        </div>
      )}
    </>
  );
}
