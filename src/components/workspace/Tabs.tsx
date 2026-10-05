// Perspective navigation (M9.0). Plain links — works without client JS, keeps the URL shareable.
import Link from "next/link";
import { FOCUS } from "./shared";

export type WorkspaceView = "overview" | "holdings" | "exposure" | "scenarios" | "insights";

export const VIEWS: { id: WorkspaceView; label: string; question: string }[] = [
  { id: "overview", label: "Overview", question: "What does this portfolio look like?" },
  { id: "holdings", label: "Holdings", question: "What exactly do we own?" },
  { id: "exposure", label: "Exposure", question: "Where are risk, concentration and maturity?" },
  { id: "scenarios", label: "Scenarios", question: "What happens under my assumptions?" },
  { id: "insights", label: "Insights", question: "What materially deserves attention?" },
];

export const parseView = (raw: string | undefined, hasPosition: boolean): WorkspaceView => VIEWS.find((v) => v.id === raw)?.id ?? (hasPosition ? "holdings" : "overview");

export function WorkspaceTabs({ portfolioId, current }: { portfolioId: string; current: WorkspaceView }) {
  return (
    <nav aria-label="Portfolio perspectives" className="sticky top-0 z-10 -mx-4 overflow-x-auto border-b border-zinc-200 bg-white px-4 shadow-[0_1px_0_rgba(0,0,0,0.02)] dark:border-zinc-800 dark:bg-zinc-950 sm:-mx-6 sm:px-6">
      <ul className="mx-auto flex max-w-6xl gap-1">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <Link href={`/portfolios/${portfolioId}?view=${v.id}`} aria-current={v.id === current ? "page" : undefined} title={v.question} className={`relative block whitespace-nowrap px-3.5 py-3 text-sm font-medium transition-colors ${FOCUS} ${v.id === current ? "text-zinc-950 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-blue-600 dark:text-white dark:after:bg-blue-400" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>
              {v.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
