-- CreateEnum
CREATE TYPE "ObservationKind" AS ENUM ('AUCTION_PRIMARY', 'SECONDARY_MARKET');

-- AlterTable
ALTER TABLE "FixedIncomeObservation" ADD COLUMN     "observationKind" "ObservationKind" NOT NULL;

-- AlterTable
ALTER TABLE "FixedIncomeSecurity" ADD COLUMN     "isin" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FixedIncomeSecurity_isin_key" ON "FixedIncomeSecurity"("isin");

