"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "korbly-theme";

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="10" cy="10" r="3.5" />
      <path
        strokeLinecap="round"
        d="M10 2v1.5M10 16.5V18M4.2 4.2l1.1 1.1M14.7 14.7l1.1 1.1M2 10h1.5M16.5 10H18M4.2 15.8l1.1-1.1M14.7 5.3l1.1-1.1"
      />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M17.5 12.5a7.5 7.5 0 0 1-9.9-9.9A8 8 0 1 0 17.5 12.5Z" />
    </svg>
  );
}

/**
 * Explicit light/dark toggle. Defaults to system preference (handled by
 * the blocking inline script in layout.tsx, which sets the `.dark` class
 * before first paint). Clicking sets an explicit user preference in
 * localStorage that overrides system preference from then on.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState<boolean | null>(null);

  useEffect(() => {
    // Reads the class the pre-hydration blocking script (ThemeScript) set
    // on <html>. Must run post-mount, not during the initial render, so
    // this client component's server-rendered and first-client-rendered
    // output match (avoiding a hydration mismatch) — the standard
    // mount-detection exception to "don't setState in an effect".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // localStorage unavailable (private browsing, etc.) — theme still
      // toggles for this page view, just won't persist.
    }
    setIsDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {isDark === null ? (
        <span className="block h-4 w-4" />
      ) : isDark ? (
        <SunIcon className="h-4 w-4" />
      ) : (
        <MoonIcon className="h-4 w-4" />
      )}
    </button>
  );
}
