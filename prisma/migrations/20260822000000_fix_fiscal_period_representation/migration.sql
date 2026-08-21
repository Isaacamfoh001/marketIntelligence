-- CreateEnum
CREATE TYPE "FiscalPeriod" AS ENUM ('ANNUAL', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'NINE_MONTH');

-- DropIndex
DROP INDEX "FinancialPeriod_companyId_periodType_fiscalYear_fiscalQuart_key";

-- AlterTable
ALTER TABLE "FinancialPeriod" DROP COLUMN "fiscalQuarter",
DROP COLUMN "periodType",
ADD COLUMN     "period" "FiscalPeriod" NOT NULL;

-- DropEnum
DROP TYPE "FinancialPeriodType";

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_companyId_period_fiscalYear_statementScope_key" ON "FinancialPeriod"("companyId", "period", "fiscalYear", "statementScope");

