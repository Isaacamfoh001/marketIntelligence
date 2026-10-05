import Link from "next/link";
import { getEquitySourceStatus } from "@/lib/queries/equity-source";
import { describeSourceNotice } from "@/lib/equities/source-notice";

/**
 * One factual statement about the GSE equity pipeline (NOT about any single
 * security — per-security trade recency is shown separately).
 *
 *  - "always":       Equities page — report date, last actual trade, last import.
 *  - "problem-only": Portfolio / Scenario pages — silent while the source is
 *                    current; a prominent notice when Korbly's GSE data is
 *                    behind, missing, or the last refresh failed.
 */
export async function EquitySourceNotice({ mode }: { mode: "always" | "problem-only" }) {
  const status = await getEquitySourceStatus();
  const notice = describeSourceNotice(status);
  if (mode === "problem-only" && notice.tone === "ok") return null;

  const tone = {
    ok: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
    warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200",
  }[notice.tone];

  return (
    <div role={notice.tone === "warn" ? "alert" : "status"} className={`rounded border px-3 py-2 text-xs ${tone}`}>
      <p className="font-medium">{notice.headline}</p>
      {notice.details.length > 0 && (
        <ul className="mt-1 space-y-0.5 opacity-90">
          {notice.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <p className="mt-1">
        <Link href="/data-centre" className="underline">
          GSE equity data status in Data Centre
        </Link>
      </p>
    </div>
  );
}
