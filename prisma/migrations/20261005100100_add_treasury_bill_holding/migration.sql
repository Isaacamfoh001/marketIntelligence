-- AlterTable
ALTER TABLE "PortfolioPosition" ADD COLUMN     "treasuryBillId" TEXT;

-- AlterTable
ALTER TABLE "ScenarioShock" ADD COLUMN     "treasuryBillId" TEXT;

-- CreateTable
CREATE TABLE "TreasuryBill" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "isin" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TreasuryBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryBill_isin_key" ON "TreasuryBill"("isin");

-- CreateIndex
CREATE INDEX "TreasuryBill_maturityDate_idx" ON "TreasuryBill"("maturityDate");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryBill_instrumentId_maturityDate_key" ON "TreasuryBill"("instrumentId", "maturityDate");

-- CreateIndex
CREATE INDEX "PortfolioPosition_treasuryBillId_idx" ON "PortfolioPosition"("treasuryBillId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioPosition_portfolioId_treasuryBillId_key" ON "PortfolioPosition"("portfolioId", "treasuryBillId");

-- CreateIndex
CREATE INDEX "ScenarioShock_treasuryBillId_idx" ON "ScenarioShock"("treasuryBillId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioShock_scenarioId_treasuryBillId_key" ON "ScenarioShock"("scenarioId", "treasuryBillId");

-- AddForeignKey
ALTER TABLE "TreasuryBill" ADD CONSTRAINT "TreasuryBill_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "TreasuryInstrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioPosition" ADD CONSTRAINT "PortfolioPosition_treasuryBillId_fkey" FOREIGN KEY ("treasuryBillId") REFERENCES "TreasuryBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_treasuryBillId_fkey" FOREIGN KEY ("treasuryBillId") REFERENCES "TreasuryBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Cross-field invariants Prisma cannot express (M8.5): a position is a bond, an
-- equity OR a Treasury bill; a bill position is (treasuryBillId + positive GHS
-- FACE amount in nominalGhs) with nothing else set. Replaces the M8.1 check.
ALTER TABLE "PortfolioPosition" DROP CONSTRAINT "PortfolioPosition_shape_check";
ALTER TABLE "PortfolioPosition"
  ADD CONSTRAINT "PortfolioPosition_shape_check" CHECK (
    (
      "assetClass" = 'BOND'
      AND "fixedIncomeSecurityId" IS NOT NULL
      AND "nominalGhs" IS NOT NULL AND "nominalGhs" > 0
      AND "securityId" IS NULL AND "shares" IS NULL AND "treasuryBillId" IS NULL
    )
    OR
    (
      "assetClass" = 'EQUITY'
      AND "securityId" IS NOT NULL
      AND "shares" IS NOT NULL AND "shares" > 0
      AND "fixedIncomeSecurityId" IS NULL AND "nominalGhs" IS NULL AND "treasuryBillId" IS NULL
    )
    OR
    (
      "assetClass" = 'TREASURY_BILL'
      AND "treasuryBillId" IS NOT NULL
      AND "nominalGhs" IS NOT NULL AND "nominalGhs" > 0
      AND "fixedIncomeSecurityId" IS NULL AND "securityId" IS NULL AND "shares" IS NULL
    )
  );

-- A bill's original tenor is one BoG actually auctions, and its terms are internally consistent
-- (issue date = maturity − tenor) — checked in the service against TreasuryInstrument.tenorDays;
-- the database guarantees the structural parts here.
ALTER TABLE "TreasuryBill"
  ADD CONSTRAINT "TreasuryBill_dates_check" CHECK ("maturityDate" > "issueDate" AND "currency" = 'GHS');

-- Scenario targets (M8.5): Treasury bills take a YIELD_BPS (rate) shock, at asset-class or
-- specific-bill level; issuer rules may still be either type.
ALTER TABLE "ScenarioShock" DROP CONSTRAINT "ScenarioShock_target_check";
ALTER TABLE "ScenarioShock"
  ADD CONSTRAINT "ScenarioShock_target_check" CHECK (
    (
      "targetKind" = 'ASSET_CLASS'
      AND "assetClass" IS NOT NULL
      AND "companyId" IS NULL AND "issuerNameKey" IS NULL
      AND "fixedIncomeSecurityId" IS NULL AND "securityId" IS NULL AND "treasuryBillId" IS NULL
      AND (
        ("assetClass" IN ('TREASURY_BILL', 'GOVERNMENT_BOND', 'CORPORATE_BOND') AND "shockType" = 'YIELD_BPS')
        OR ("assetClass" = 'EQUITY' AND "shockType" = 'PRICE_PCT')
      )
    )
    OR
    (
      "targetKind" = 'ISSUER'
      AND "assetClass" IS NULL
      AND "fixedIncomeSecurityId" IS NULL AND "securityId" IS NULL AND "treasuryBillId" IS NULL
      AND (("companyId" IS NOT NULL AND "issuerNameKey" IS NULL) OR ("companyId" IS NULL AND "issuerNameKey" IS NOT NULL AND length(btrim("issuerNameKey")) > 0))
    )
    OR
    (
      "targetKind" = 'SECURITY'
      AND "assetClass" IS NULL
      AND "companyId" IS NULL AND "issuerNameKey" IS NULL
      AND (
        ("fixedIncomeSecurityId" IS NOT NULL AND "securityId" IS NULL AND "treasuryBillId" IS NULL AND "shockType" = 'YIELD_BPS')
        OR ("securityId" IS NOT NULL AND "fixedIncomeSecurityId" IS NULL AND "treasuryBillId" IS NULL AND "shockType" = 'PRICE_PCT')
        OR ("treasuryBillId" IS NOT NULL AND "fixedIncomeSecurityId" IS NULL AND "securityId" IS NULL AND "shockType" = 'YIELD_BPS')
      )
    )
  );
