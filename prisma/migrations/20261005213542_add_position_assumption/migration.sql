-- CreateEnum
CREATE TYPE "PositionAssumptionKind" AS ENUM ('YIELD_PCT', 'RATE_PCT', 'PRICE_PER_100', 'PAR', 'SHARE_PRICE_GHS');

-- CreateTable
CREATE TABLE "PositionAssumption" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "kind" "PositionAssumptionKind" NOT NULL,
    "value" DECIMAL(20,8),
    "overridesReference" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionAssumption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositionAssumption_positionId_key" ON "PositionAssumption"("positionId");

-- AddForeignKey
ALTER TABLE "PositionAssumption" ADD CONSTRAINT "PositionAssumption_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PortfolioPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cross-field invariant Prisma cannot express (M9.0.1): the assumption kind must
-- match the held asset class and carry the right value. PAR carries no value;
-- price kinds are strictly positive; rate kinds are within [0, 100] percent.
ALTER TABLE "PositionAssumption"
  ADD CONSTRAINT "PositionAssumption_shape_check" CHECK (
    (("kind" = 'PAR') AND "value" IS NULL)
    OR (("kind" IN ('PRICE_PER_100', 'SHARE_PRICE_GHS')) AND "value" IS NOT NULL AND "value" > 0)
    OR (("kind" IN ('YIELD_PCT', 'RATE_PCT')) AND "value" IS NOT NULL AND "value" >= 0 AND "value" <= 100)
  );
