-- CreateEnum
CREATE TYPE "PortfolioAssetClass" AS ENUM ('BOND', 'EQUITY');

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioPosition" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "assetClass" "PortfolioAssetClass" NOT NULL,
    "fixedIncomeSecurityId" TEXT,
    "nominalGhs" DECIMAL(20,2),
    "securityId" TEXT,
    "shares" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Portfolio_archivedAt_idx" ON "Portfolio"("archivedAt");

-- CreateIndex
CREATE INDEX "PortfolioPosition_portfolioId_idx" ON "PortfolioPosition"("portfolioId");

-- CreateIndex
CREATE INDEX "PortfolioPosition_fixedIncomeSecurityId_idx" ON "PortfolioPosition"("fixedIncomeSecurityId");

-- CreateIndex
CREATE INDEX "PortfolioPosition_securityId_idx" ON "PortfolioPosition"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioPosition_portfolioId_fixedIncomeSecurityId_key" ON "PortfolioPosition"("portfolioId", "fixedIncomeSecurityId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioPosition_portfolioId_securityId_key" ON "PortfolioPosition"("portfolioId", "securityId");

-- AddForeignKey
ALTER TABLE "PortfolioPosition" ADD CONSTRAINT "PortfolioPosition_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioPosition" ADD CONSTRAINT "PortfolioPosition_fixedIncomeSecurityId_fkey" FOREIGN KEY ("fixedIncomeSecurityId") REFERENCES "FixedIncomeSecurity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioPosition" ADD CONSTRAINT "PortfolioPosition_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-field invariants Prisma cannot express (M8.1): a position is EITHER a
-- bond (fixed-income FK + positive nominal GHS, nothing else) OR an equity
-- (security FK + positive whole shares, nothing else). No generic quantity,
-- no zero/negative size, no mixed rows.
ALTER TABLE "PortfolioPosition"
  ADD CONSTRAINT "PortfolioPosition_shape_check" CHECK (
    (
      "assetClass" = 'BOND'
      AND "fixedIncomeSecurityId" IS NOT NULL
      AND "nominalGhs" IS NOT NULL AND "nominalGhs" > 0
      AND "securityId" IS NULL
      AND "shares" IS NULL
    )
    OR
    (
      "assetClass" = 'EQUITY'
      AND "securityId" IS NOT NULL
      AND "shares" IS NOT NULL AND "shares" > 0
      AND "fixedIncomeSecurityId" IS NULL
      AND "nominalGhs" IS NULL
    )
  );
