import { CompaniesTable } from "@/components/CompaniesTable";
import { getCompanyLandingRows } from "@/lib/queries/companies";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const rows = await getCompanyLandingRows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Companies</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Market performance and fundamental financial performance for Korbly&rsquo;s covered Ghana Stock Exchange companies.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Awaiting first company financials import</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-zinc-400 dark:text-zinc-500">
            Company coverage starts once a GSE security is imported (Equities) or a company financial statement is
            imported (Data Centre → Import Market Data → Company Financials). Neither has happened yet.
          </p>
        </div>
      ) : (
        <CompaniesTable rows={rows} />
      )}
    </div>
  );
}
