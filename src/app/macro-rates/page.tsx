export default function MacroRatesPage() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Macro &amp; Rates
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Inflation, policy rates, Treasury bills, FX, and GDP data will appear here.
      </p>
      <div className="mt-6 rounded border border-zinc-200 bg-zinc-50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-400">No data available yet</p>
      </div>
    </div>
  );
}
