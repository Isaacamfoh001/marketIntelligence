-- CreateEnum
CREATE TYPE "FixedIncomeClassification" AS ENUM ('SOVEREIGN', 'CORPORATE');

-- CreateEnum
CREATE TYPE "FixedIncomeInstrumentType" AS ENUM ('GOVERNMENT_BOND', 'CORPORATE_BOND');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('FIXED', 'FLOATING', 'ZERO_COUPON');

-- CreateEnum
CREATE TYPE "CouponFrequency" AS ENUM ('ANNUAL', 'SEMI_ANNUAL', 'QUARTERLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "FixedIncomeSecurityStatus" AS ENUM ('ACTIVE', 'MATURED', 'CALLED', 'DEFAULTED');

-- CreateTable
CREATE TABLE "FixedIncomeSecurity" (
    "id" TEXT NOT NULL,
    "instrumentCode" TEXT NOT NULL,
    "instrumentName" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "companyId" TEXT,
    "instrumentType" "FixedIncomeInstrumentType" NOT NULL,
    "classification" "FixedIncomeClassification" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "issueDate" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "couponType" "CouponType" NOT NULL,
    "couponRatePct" DECIMAL(9,4),
    "couponFrequency" "CouponFrequency",
    "faceValue" DECIMAL(18,2) NOT NULL DEFAULT 100,
    "status" "FixedIncomeSecurityStatus" NOT NULL DEFAULT 'ACTIVE',
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedIncomeSecurity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedIncomeObservation" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "cleanPrice" DECIMAL(12,4),
    "sourceYieldPct" DECIMAL(9,4),
    "volumeTradedGhs" DECIMAL(20,2),
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedIncomeObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FixedIncomeSecurity_instrumentCode_key" ON "FixedIncomeSecurity"("instrumentCode");

-- CreateIndex
CREATE INDEX "FixedIncomeSecurity_instrumentType_idx" ON "FixedIncomeSecurity"("instrumentType");

-- CreateIndex
CREATE INDEX "FixedIncomeSecurity_classification_idx" ON "FixedIncomeSecurity"("classification");

-- CreateIndex
CREATE INDEX "FixedIncomeSecurity_maturityDate_idx" ON "FixedIncomeSecurity"("maturityDate");

-- CreateIndex
CREATE INDEX "FixedIncomeSecurity_companyId_idx" ON "FixedIncomeSecurity"("companyId");

-- CreateIndex
CREATE INDEX "FixedIncomeSecurity_sourceId_idx" ON "FixedIncomeSecurity"("sourceId");

-- CreateIndex
CREATE INDEX "FixedIncomeSecurity_ingestionRunId_idx" ON "FixedIncomeSecurity"("ingestionRunId");

-- CreateIndex
CREATE INDEX "FixedIncomeObservation_securityId_idx" ON "FixedIncomeObservation"("securityId");

-- CreateIndex
CREATE INDEX "FixedIncomeObservation_observationDate_idx" ON "FixedIncomeObservation"("observationDate");

-- CreateIndex
CREATE INDEX "FixedIncomeObservation_sourceId_idx" ON "FixedIncomeObservation"("sourceId");

-- CreateIndex
CREATE INDEX "FixedIncomeObservation_ingestionRunId_idx" ON "FixedIncomeObservation"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedIncomeObservation_securityId_observationDate_key" ON "FixedIncomeObservation"("securityId", "observationDate");

-- AddForeignKey
ALTER TABLE "FixedIncomeSecurity" ADD CONSTRAINT "FixedIncomeSecurity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedIncomeSecurity" ADD CONSTRAINT "FixedIncomeSecurity_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedIncomeSecurity" ADD CONSTRAINT "FixedIncomeSecurity_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedIncomeObservation" ADD CONSTRAINT "FixedIncomeObservation_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "FixedIncomeSecurity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedIncomeObservation" ADD CONSTRAINT "FixedIncomeObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedIncomeObservation" ADD CONSTRAINT "FixedIncomeObservation_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
