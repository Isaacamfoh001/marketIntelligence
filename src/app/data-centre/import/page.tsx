import Link from "next/link";
import { ImportWizard } from "@/components/ImportWizard";

export default function ImportDataPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/data-centre" className="text-xs text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300">
          ← Data Centre
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Import Market Data</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Upload an official Ghana Stock Exchange export to update security prices or index history. Every import is
          previewed and validated before anything is written to the database.
        </p>
      </div>

      <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <ImportWizard />
      </div>

      <div className="rounded border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Where does this data come from?</p>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          The Ghana Stock Exchange publishes daily security prices and market summary data through its public
          Trading &amp; Data pages, and monthly Equities Market Reports / Market Summary Reports going back several
          years. Korbly does not have an automated connection to GSE&rsquo;s website — download the relevant export
          from GSE yourself (a normal browser visit, no special access needed), then import it here. This is not a
          licensed real-time feed; see the Data Centre for exactly which files are needed and how current the data is.
        </p>
      </div>
    </div>
  );
}
