-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('AUTOMATED', 'SEMI_AUTOMATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ExpectedFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "IngestionMethod" AS ENUM ('API', 'FILE_UPLOAD', 'FILE_IMPORT', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

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

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
