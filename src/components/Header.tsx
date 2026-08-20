import Link from "next/link";

export function Header() {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
      <Link href="/" className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Korbly Market Intelligence
        </span>
      </Link>
      <span className="ml-3 text-xs text-zinc-400">|</span>
      <span className="ml-3 text-xs text-zinc-500 dark:text-zinc-400">
        Ghana Market Overview
      </span>
    </header>
  );
}
