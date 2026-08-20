-- CreateEnum
CREATE TYPE "PolicyDecisionType" AS ENUM ('HIKE', 'CUT', 'HOLD');

-- CreateTable
CREATE TABLE "PolicyDecision" (
    "id" TEXT NOT NULL,
    "decisionDate" DATE NOT NULL,
    "resultingRate" DECIMAL(9,4) NOT NULL,
    "decisionType" "PolicyDecisionType" NOT NULL,
    "changeBps" INTEGER,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PolicyDecision_decisionDate_idx" ON "PolicyDecision"("decisionDate");

-- CreateIndex
CREATE INDEX "PolicyDecision_sourceId_idx" ON "PolicyDecision"("sourceId");

-- CreateIndex
CREATE INDEX "PolicyDecision_ingestionRunId_idx" ON "PolicyDecision"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyDecision_decisionDate_key" ON "PolicyDecision"("decisionDate");

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyDecision" ADD CONSTRAINT "PolicyDecision_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
