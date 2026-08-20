-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('AUTOMATED', 'SEMI_AUTOMATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ExpectedFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IngestionMethod" AS ENUM ('API', 'FILE_UPLOAD', 'FILE_IMPORT', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MacroFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "url" TEXT,
    "expectedFrequency" "ExpectedFrequency" NOT NULL DEFAULT 'UNKNOWN',
    "ingestionMethod" "IngestionMethod" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
    "recordsRead" INTEGER,
    "recordsAccepted" INTEGER,
    "recordsRejected" INTEGER,
    "errorMessage" TEXT,
    "triggeredBy" TEXT,
    "artifactName" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroSeries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "frequency" "MacroFrequency" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroObservation" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "value" DECIMAL(18,6) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestionRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MacroObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE INDEX "DataSource_provider_idx" ON "DataSource"("provider");

-- CreateIndex
CREATE INDEX "DataSource_active_idx" ON "DataSource"("active");

-- CreateIndex
CREATE INDEX "IngestionRun_dataSourceId_idx" ON "IngestionRun"("dataSourceId");

-- CreateIndex
CREATE INDEX "IngestionRun_status_idx" ON "IngestionRun"("status");

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE INDEX "IngestionRun_completedAt_idx" ON "IngestionRun"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MacroSeries_code_key" ON "MacroSeries"("code");

-- CreateIndex
CREATE INDEX "MacroSeries_sourceId_idx" ON "MacroSeries"("sourceId");

-- CreateIndex
CREATE INDEX "MacroSeries_category_idx" ON "MacroSeries"("category");

-- CreateIndex
CREATE INDEX "MacroObservation_seriesId_idx" ON "MacroObservation"("seriesId");

-- CreateIndex
CREATE INDEX "MacroObservation_observationDate_idx" ON "MacroObservation"("observationDate");

-- CreateIndex
CREATE INDEX "MacroObservation_ingestionRunId_idx" ON "MacroObservation"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MacroObservation_seriesId_observationDate_key" ON "MacroObservation"("seriesId", "observationDate");

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroSeries" ADD CONSTRAINT "MacroSeries_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroObservation" ADD CONSTRAINT "MacroObservation_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MacroSeries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MacroObservation" ADD CONSTRAINT "MacroObservation_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
