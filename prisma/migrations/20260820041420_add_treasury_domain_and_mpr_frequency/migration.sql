-- AlterEnum
ALTER TYPE "MacroFrequency" ADD VALUE 'AD_HOC';

-- CreateTable
CREATE TABLE "TreasuryInstrument" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenorDays" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "instrumentType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryInstrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreasuryRate" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "tenderNumber" TEXT,
    "discountRate" DECIMAL(9,4) NOT NULL,
    "interestRate" DECIMAL(9,4) NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryInstrument_code_key" ON "TreasuryInstrument"("code");

-- CreateIndex
CREATE INDEX "TreasuryInstrument_active_idx" ON "TreasuryInstrument"("active");

-- CreateIndex
CREATE INDEX "TreasuryRate_instrumentId_idx" ON "TreasuryRate"("instrumentId");

-- CreateIndex
CREATE INDEX "TreasuryRate_observationDate_idx" ON "TreasuryRate"("observationDate");

-- CreateIndex
CREATE INDEX "TreasuryRate_sourceId_idx" ON "TreasuryRate"("sourceId");

-- CreateIndex
CREATE INDEX "TreasuryRate_ingestionRunId_idx" ON "TreasuryRate"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryRate_instrumentId_observationDate_key" ON "TreasuryRate"("instrumentId", "observationDate");

-- AddForeignKey
ALTER TABLE "TreasuryRate" ADD CONSTRAINT "TreasuryRate_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "TreasuryInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryRate" ADD CONSTRAINT "TreasuryRate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreasuryRate" ADD CONSTRAINT "TreasuryRate_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
