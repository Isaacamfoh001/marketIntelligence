import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={className}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Toggle navigation"
        className="-ml-1 rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 md:hidden"
      >
        <MenuIcon className="h-5 w-5" />
      </button>

      <Link href="/" className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Korbly Market Intelligence
        </span>
      </Link>
      <span className="hidden text-xs text-zinc-400 sm:inline">|</span>
      <span className="hidden truncate text-xs text-zinc-500 sm:inline dark:text-zinc-400">
        Ghana Market Overview
      </span>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  );
}
