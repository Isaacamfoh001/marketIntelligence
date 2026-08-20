export default function CompaniesPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Companies
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Company financials, ratios, and market performance will appear here.
      </p>
      <div className="mt-6 rounded border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-400">No data available yet</p>
      </div>
    </div>
  );
}
