-- CreateEnum
CREATE TYPE "ThesisStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CHALLENGED', 'INVALIDATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ThesisConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ThesisHorizon" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- CreateTable
CREATE TABLE "Thesis" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "belief" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "securityId" TEXT,
    "fixedIncomeSecurityId" TEXT,
    "treasuryInstrumentId" TEXT,
    "status" "ThesisStatus" NOT NULL DEFAULT 'DRAFT',
    "statusNote" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" "ThesisConfidence",
    "horizon" "ThesisHorizon",
    "mustBeTrue" TEXT[],
    "risks" TEXT[],
    "invalidation" TEXT[],
    "catalysts" TEXT[],
    "watching" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Thesis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Thesis_status_idx" ON "Thesis"("status");
CREATE INDEX "Thesis_securityId_idx" ON "Thesis"("securityId");
CREATE INDEX "Thesis_fixedIncomeSecurityId_idx" ON "Thesis"("fixedIncomeSecurityId");
CREATE INDEX "Thesis_treasuryInstrumentId_idx" ON "Thesis"("treasuryInstrumentId");
CREATE INDEX "Thesis_updatedAt_idx" ON "Thesis"("updatedAt");

-- AddForeignKey
ALTER TABLE "Thesis" ADD CONSTRAINT "Thesis_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Thesis" ADD CONSTRAINT "Thesis_fixedIncomeSecurityId_fkey" FOREIGN KEY ("fixedIncomeSecurityId") REFERENCES "FixedIncomeSecurity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Thesis" ADD CONSTRAINT "Thesis_treasuryInstrumentId_fkey" FOREIGN KEY ("treasuryInstrumentId") REFERENCES "TreasuryInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-field invariant Prisma cannot express (M9.1): exactly one subject.
ALTER TABLE "Thesis"
  ADD CONSTRAINT "Thesis_subject_check" CHECK (
    (CASE WHEN "securityId" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "fixedIncomeSecurityId" IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN "treasuryInstrumentId" IS NOT NULL THEN 1 ELSE 0 END) = 1
  );
