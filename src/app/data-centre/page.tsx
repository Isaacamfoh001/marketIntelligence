export default function DataCentrePage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Data Centre
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Data source health, ingestion history, and manual import tools will appear here.
      </p>
      <div className="mt-6 rounded border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-400">No data available yet</p>
      </div>
    </div>
  );
}
