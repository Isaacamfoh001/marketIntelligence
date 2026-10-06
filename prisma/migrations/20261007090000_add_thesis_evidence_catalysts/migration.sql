-- CreateEnum
CREATE TYPE "ThesisConditionKind" AS ENUM ('MUST_BE_TRUE', 'INVALIDATION');

-- CreateEnum
CREATE TYPE "InvalidationFlag" AS ENUM ('NOT_OBSERVED', 'POTENTIALLY_TRIGGERED', 'TRIGGERED');

-- CreateEnum
CREATE TYPE "CatalystStatus" AS ENUM ('WATCHING', 'OCCURRED', 'MISSED', 'NO_LONGER_RELEVANT');

-- CreateEnum
CREATE TYPE "CatalystWindowKind" AS ENUM ('NONE', 'DATE', 'MONTH', 'QUARTER');

-- CreateEnum
CREATE TYPE "EvidenceStance" AS ENUM ('SUPPORTS', 'CHALLENGES', 'CONTEXT');

-- CreateEnum
CREATE TYPE "EvidenceRelevance" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('KORBLY_DATA', 'OFFICIAL_SOURCE', 'COMPANY_DISCLOSURE', 'EXTERNAL_SOURCE', 'ANALYST_OBSERVATION');

-- CreateEnum
CREATE TYPE "EvidenceRefKind" AS ENUM ('MACRO_OBSERVATION', 'POLICY_DECISION', 'TREASURY_RATE', 'FX_RATE', 'EQUITY_PRICE', 'BOND_OBSERVATION');

-- CreateTable
CREATE TABLE "ThesisCondition" (
    "id" TEXT NOT NULL,
    "thesisId" TEXT NOT NULL,
    "kind" "ThesisConditionKind" NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "flag" "InvalidationFlag" NOT NULL DEFAULT 'NOT_OBSERVED',
    "flagNote" TEXT,
    "flagChangedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThesisCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThesisCatalyst" (
    "id" TEXT NOT NULL,
    "thesisId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "windowKind" "CatalystWindowKind" NOT NULL DEFAULT 'NONE',
    "windowStart" DATE,
    "windowEnd" DATE,
    "status" "CatalystStatus" NOT NULL DEFAULT 'WATCHING',
    "occurredOn" DATE,
    "outcomeNote" TEXT,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThesisCatalyst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThesisEvidence" (
    "id" TEXT NOT NULL,
    "thesisId" TEXT NOT NULL,
    "conditionId" TEXT,
    "catalystId" TEXT,
    "stance" "EvidenceStance" NOT NULL,
    "relevance" "EvidenceRelevance" NOT NULL,
    "sourceType" "EvidenceSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "note" TEXT,
    "observedAt" DATE,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "refKind" "EvidenceRefKind",
    "refId" TEXT,
    "snapshot" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThesisEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThesisReview" (
    "id" TEXT NOT NULL,
    "thesisId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "statusAtReview" "ThesisStatus" NOT NULL,
    "confidenceAtReview" "ThesisConfidence",

    CONSTRAINT "ThesisReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThesisCondition_thesisId_kind_idx" ON "ThesisCondition"("thesisId", "kind");

-- CreateIndex
CREATE INDEX "ThesisCatalyst_thesisId_idx" ON "ThesisCatalyst"("thesisId");

-- CreateIndex
CREATE INDEX "ThesisEvidence_thesisId_createdAt_idx" ON "ThesisEvidence"("thesisId", "createdAt");

-- CreateIndex
CREATE INDEX "ThesisEvidence_conditionId_idx" ON "ThesisEvidence"("conditionId");

-- CreateIndex
CREATE INDEX "ThesisEvidence_catalystId_idx" ON "ThesisEvidence"("catalystId");

-- CreateIndex
CREATE INDEX "ThesisEvidence_refKind_refId_idx" ON "ThesisEvidence"("refKind", "refId");

-- CreateIndex
CREATE INDEX "ThesisReview_thesisId_reviewedAt_idx" ON "ThesisReview"("thesisId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "ThesisCondition" ADD CONSTRAINT "ThesisCondition_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisCatalyst" ADD CONSTRAINT "ThesisCatalyst_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisEvidence" ADD CONSTRAINT "ThesisEvidence_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisEvidence" ADD CONSTRAINT "ThesisEvidence_conditionId_fkey" FOREIGN KEY ("conditionId") REFERENCES "ThesisCondition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisEvidence" ADD CONSTRAINT "ThesisEvidence_catalystId_fkey" FOREIGN KEY ("catalystId") REFERENCES "ThesisCatalyst"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisReview" ADD CONSTRAINT "ThesisReview_thesisId_fkey" FOREIGN KEY ("thesisId") REFERENCES "Thesis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (M9.2): the M9.1 text[] lists become rows with stable ids, in their original order,
-- BEFORE the columns are dropped. Nothing the analyst wrote is lost.
INSERT INTO "ThesisCondition" ("id", "thesisId", "kind", "text", "position", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'MUST_BE_TRUE', u.item, (u.ord - 1)::int, CURRENT_TIMESTAMP
FROM "Thesis" t, LATERAL unnest(t."mustBeTrue") WITH ORDINALITY AS u(item, ord);

INSERT INTO "ThesisCondition" ("id", "thesisId", "kind", "text", "position", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'INVALIDATION', u.item, (u.ord - 1)::int, CURRENT_TIMESTAMP
FROM "Thesis" t, LATERAL unnest(t."invalidation") WITH ORDINALITY AS u(item, ord);

INSERT INTO "ThesisCatalyst" ("id", "thesisId", "description", "position", "updatedAt")
SELECT gen_random_uuid()::text, t."id", u.item, (u.ord - 1)::int, CURRENT_TIMESTAMP
FROM "Thesis" t, LATERAL unnest(t."catalysts") WITH ORDINALITY AS u(item, ord);

-- AlterTable
ALTER TABLE "Thesis" DROP COLUMN "catalysts",
DROP COLUMN "invalidation",
DROP COLUMN "mustBeTrue";

-- Cross-field invariants Prisma cannot express (M9.2).
-- A flag is only meaningful on an invalidation condition.
ALTER TABLE "ThesisCondition" ADD CONSTRAINT "ThesisCondition_flag_check"
  CHECK ("kind" = 'INVALIDATION' OR "flag" = 'NOT_OBSERVED');

-- Evidence points at one target at most: a condition, a catalyst, or neither (the whole thesis).
ALTER TABLE "ThesisEvidence" ADD CONSTRAINT "ThesisEvidence_target_check"
  CHECK ("conditionId" IS NULL OR "catalystId" IS NULL);

-- Korbly-linked evidence always carries its pointer AND its snapshot; manual evidence carries neither.
ALTER TABLE "ThesisEvidence" ADD CONSTRAINT "ThesisEvidence_link_check"
  CHECK (
    ("sourceType" = 'KORBLY_DATA' AND "refKind" IS NOT NULL AND "refId" IS NOT NULL AND "snapshot" IS NOT NULL)
    OR ("sourceType" <> 'KORBLY_DATA' AND "refKind" IS NULL AND "refId" IS NULL AND "snapshot" IS NULL)
  );

-- The same observation is linked to a thesis once (an archived link may be re-added).
CREATE UNIQUE INDEX "ThesisEvidence_thesis_ref_active_key"
  ON "ThesisEvidence" ("thesisId", "refKind", "refId") WHERE "archivedAt" IS NULL AND "refId" IS NOT NULL;

-- A catalyst window is a valid, ordered date range (or absent).
ALTER TABLE "ThesisCatalyst" ADD CONSTRAINT "ThesisCatalyst_window_check"
  CHECK (
    ("windowKind" = 'NONE' AND "windowStart" IS NULL AND "windowEnd" IS NULL)
    OR ("windowKind" <> 'NONE' AND "windowStart" IS NOT NULL AND "windowEnd" IS NOT NULL AND "windowStart" <= "windowEnd")
  );
