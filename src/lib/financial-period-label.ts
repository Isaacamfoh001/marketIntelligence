// ---------------------------------------------------------------------------
// Pure period-label formatting — deliberately its own module with zero
// server-side imports (no Prisma), so client components (e.g.
// ImportWizard.tsx's preview table) can use it without pulling the whole
// server query layer — and its `pg` dependency — into the browser bundle.
// ---------------------------------------------------------------------------

export function formatPeriodLabel(period: { periodType: string; fiscalYear: number; fiscalQuarter: number }): string {
  if (period.periodType === "ANNUAL") return `FY${period.fiscalYear}`;
  if (period.periodType === "HALF_YEAR") return `H${period.fiscalQuarter} ${period.fiscalYear}`;
  return `Q${period.fiscalQuarter} ${period.fiscalYear}`;
}
