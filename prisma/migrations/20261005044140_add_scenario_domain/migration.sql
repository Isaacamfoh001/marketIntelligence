-- CreateEnum
CREATE TYPE "ScenarioShockType" AS ENUM ('YIELD_BPS', 'PRICE_PCT');

-- CreateEnum
CREATE TYPE "ScenarioTargetKind" AS ENUM ('ASSET_CLASS', 'ISSUER', 'SECURITY');

-- CreateEnum
CREATE TYPE "ScenarioAssetClass" AS ENUM ('GOVERNMENT_BOND', 'CORPORATE_BOND', 'EQUITY');

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioShock" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "targetKind" "ScenarioTargetKind" NOT NULL,
    "shockType" "ScenarioShockType" NOT NULL,
    "value" DECIMAL(9,2) NOT NULL,
    "assetClass" "ScenarioAssetClass",
    "companyId" TEXT,
    "issuerNameKey" TEXT,
    "fixedIncomeSecurityId" TEXT,
    "securityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioShock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Scenario_portfolioId_idx" ON "Scenario"("portfolioId");

-- CreateIndex
CREATE INDEX "Scenario_archivedAt_idx" ON "Scenario"("archivedAt");

-- CreateIndex
CREATE INDEX "ScenarioShock_scenarioId_idx" ON "ScenarioShock"("scenarioId");

-- CreateIndex
CREATE INDEX "ScenarioShock_companyId_idx" ON "ScenarioShock"("companyId");

-- CreateIndex
CREATE INDEX "ScenarioShock_fixedIncomeSecurityId_idx" ON "ScenarioShock"("fixedIncomeSecurityId");

-- CreateIndex
CREATE INDEX "ScenarioShock_securityId_idx" ON "ScenarioShock"("securityId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioShock_scenarioId_assetClass_key" ON "ScenarioShock"("scenarioId", "assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioShock_scenarioId_shockType_companyId_key" ON "ScenarioShock"("scenarioId", "shockType", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioShock_scenarioId_shockType_issuerNameKey_key" ON "ScenarioShock"("scenarioId", "shockType", "issuerNameKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioShock_scenarioId_fixedIncomeSecurityId_key" ON "ScenarioShock"("scenarioId", "fixedIncomeSecurityId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioShock_scenarioId_securityId_key" ON "ScenarioShock"("scenarioId", "securityId");

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_fixedIncomeSecurityId_fkey" FOREIGN KEY ("fixedIncomeSecurityId") REFERENCES "FixedIncomeSecurity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioShock" ADD CONSTRAINT "ScenarioShock_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cross-field invariants Prisma cannot express (M8.3). A shock has EXACTLY one
-- target, matching its targetKind, and a shock type that is compatible with
-- that target's asset domain (YIELD_BPS → bonds, PRICE_PCT → equities; an
-- issuer shock may be either — the type then fixes which of the issuer's
-- instruments it reaches). Value bounds are explicit rejections, never clamps:
--   YIELD_BPS: [-2000, 2000] bps     PRICE_PCT: [-100, 1000] % (an equity cannot go below zero)
ALTER TABLE "ScenarioShock"
  ADD CONSTRAINT "ScenarioShock_target_check" CHECK (
    (
      "targetKind" = 'ASSET_CLASS'
      AND "assetClass" IS NOT NULL
      AND "companyId" IS NULL AND "issuerNameKey" IS NULL
      AND "fixedIncomeSecurityId" IS NULL AND "securityId" IS NULL
      AND (
        ("assetClass" IN ('GOVERNMENT_BOND', 'CORPORATE_BOND') AND "shockType" = 'YIELD_BPS')
        OR ("assetClass" = 'EQUITY' AND "shockType" = 'PRICE_PCT')
      )
    )
    OR
    (
      "targetKind" = 'ISSUER'
      AND "assetClass" IS NULL
      AND "fixedIncomeSecurityId" IS NULL AND "securityId" IS NULL
      AND (("companyId" IS NOT NULL AND "issuerNameKey" IS NULL) OR ("companyId" IS NULL AND "issuerNameKey" IS NOT NULL AND length(btrim("issuerNameKey")) > 0))
    )
    OR
    (
      "targetKind" = 'SECURITY'
      AND "assetClass" IS NULL
      AND "companyId" IS NULL AND "issuerNameKey" IS NULL
      AND (
        ("fixedIncomeSecurityId" IS NOT NULL AND "securityId" IS NULL AND "shockType" = 'YIELD_BPS')
        OR ("securityId" IS NOT NULL AND "fixedIncomeSecurityId" IS NULL AND "shockType" = 'PRICE_PCT')
      )
    )
  );

ALTER TABLE "ScenarioShock"
  ADD CONSTRAINT "ScenarioShock_value_check" CHECK (
    ("shockType" = 'YIELD_BPS' AND "value" BETWEEN -2000 AND 2000)
    OR ("shockType" = 'PRICE_PCT' AND "value" BETWEEN -100 AND 1000)
  );
