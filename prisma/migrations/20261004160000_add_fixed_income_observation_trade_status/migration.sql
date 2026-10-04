-- M7.3.1: distinguish real trades from carried-forward closing prices, and
-- keep the source's own description/maturity for terms cross-checking.
CREATE TYPE "ObservationTradeStatus" AS ENUM ('TRADED', 'NOT_TRADED');

ALTER TABLE "FixedIncomeObservation"
  ADD COLUMN "tradeStatus" "ObservationTradeStatus",
  ADD COLUMN "numberOfTrades" INTEGER,
  ADD COLUMN "sourceSecurityDescription" TEXT,
  ADD COLUMN "sourceMaturityDate" DATE;
