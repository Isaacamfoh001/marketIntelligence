// ---------------------------------------------------------------------------
// Pure period-label formatting — deliberately its own module with zero
// server-side imports (no Prisma), so client components (e.g.
// ImportWizard.tsx's preview table) can use it without pulling the whole
// server query layer — and its `pg` dependency — into the browser bundle.
// ---------------------------------------------------------------------------

export function formatPeriodLabel(period: { period: string; fiscalYear: number }): string {
  if (period.period === "ANNUAL") return `FY${period.fiscalYear}`;
  const display = period.period === "NINE_MONTH" ? "9M" : period.period;
  return `${display} ${period.fiscalYear}`;
}
