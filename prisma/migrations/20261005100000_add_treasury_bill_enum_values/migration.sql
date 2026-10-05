-- M8.5: new enum values live in their own migration so the CHECK constraints in the
-- next migration can reference them (Postgres cannot use a new enum value in the
-- same transaction that adds it).

-- AlterEnum
ALTER TYPE "PortfolioAssetClass" ADD VALUE 'TREASURY_BILL';

-- AlterEnum
ALTER TYPE "ScenarioAssetClass" ADD VALUE 'TREASURY_BILL';
