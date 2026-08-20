-- CreateEnum
CREATE TYPE "FinancialPeriodType" AS ENUM ('ANNUAL', 'HALF_YEAR', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "StatementScope" AS ENUM ('CONSOLIDATED', 'SEPARATE');

-- CreateEnum
CREATE TYPE "MetricUnit" AS ENUM ('GHS', 'GHS_THOUSANDS', 'GHS_MILLIONS', 'PERCENT', 'PER_SHARE_GHS', 'COUNT');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "ticker" TEXT;

-- CreateTable
CREATE TABLE "FinancialPeriod" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodType" "FinancialPeriodType" NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "fiscalQuarter" INTEGER NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reportingCurrency" TEXT NOT NULL DEFAULT 'GHS',
    "statementScope" "StatementScope" NOT NULL DEFAULT 'CONSOLIDATED',
    "audited" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialMetric" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "MetricUnit" NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyFinancialObservation" (
    "id" TEXT NOT NULL,
    "financialPeriodId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "value" DECIMAL(20,4) NOT NULL,
    "reportedValue" DECIMAL(20,4),
    "reportedUnit" TEXT,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyFinancialObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialPeriod_companyId_idx" ON "FinancialPeriod"("companyId");

-- CreateIndex
CREATE INDEX "FinancialPeriod_fiscalYear_idx" ON "FinancialPeriod"("fiscalYear");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialPeriod_companyId_periodType_fiscalYear_fiscalQuart_key" ON "FinancialPeriod"("companyId", "periodType", "fiscalYear", "fiscalQuarter", "statementScope");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialMetric_code_key" ON "FinancialMetric"("code");

-- CreateIndex
CREATE INDEX "FinancialMetric_category_idx" ON "FinancialMetric"("category");

-- CreateIndex
CREATE INDEX "CompanyFinancialObservation_financialPeriodId_idx" ON "CompanyFinancialObservation"("financialPeriodId");

-- CreateIndex
CREATE INDEX "CompanyFinancialObservation_metricId_idx" ON "CompanyFinancialObservation"("metricId");

-- CreateIndex
CREATE INDEX "CompanyFinancialObservation_sourceId_idx" ON "CompanyFinancialObservation"("sourceId");

-- CreateIndex
CREATE INDEX "CompanyFinancialObservation_ingestionRunId_idx" ON "CompanyFinancialObservation"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyFinancialObservation_financialPeriodId_metricId_key" ON "CompanyFinancialObservation"("financialPeriodId", "metricId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_ticker_key" ON "Company"("ticker");

-- AddForeignKey
ALTER TABLE "FinancialPeriod" ADD CONSTRAINT "FinancialPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFinancialObservation" ADD CONSTRAINT "CompanyFinancialObservation_financialPeriodId_fkey" FOREIGN KEY ("financialPeriodId") REFERENCES "FinancialPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFinancialObservation" ADD CONSTRAINT "CompanyFinancialObservation_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "FinancialMetric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFinancialObservation" ADD CONSTRAINT "CompanyFinancialObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFinancialObservation" ADD CONSTRAINT "CompanyFinancialObservation_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

