-- CreateEnum
CREATE TYPE "SecurityType" AS ENUM ('ORDINARY_SHARE', 'PREFERENCE_SHARE', 'DEPOSITARY_SHARE', 'ETF');

-- CreateTable
CREATE TABLE "MarketIndex" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'Ghana Stock Exchange',
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketIndexObservation" (
    "id" TEXT NOT NULL,
    "marketIndexId" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "level" DECIMAL(18,4) NOT NULL,
    "changePct" DECIMAL(9,4),
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketIndexObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSummary" (
    "id" TEXT NOT NULL,
    "tradingDate" DATE NOT NULL,
    "totalVolume" BIGINT,
    "totalValueTradedGhs" DECIMAL(20,2),
    "marketCapGhs" DECIMAL(20,2),
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "exchange" TEXT NOT NULL DEFAULT 'Ghana Stock Exchange',
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Security" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "securityType" "SecurityType" NOT NULL DEFAULT 'ORDINARY_SHARE',
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Security_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityPrice" (
    "id" TEXT NOT NULL,
    "securityId" TEXT NOT NULL,
    "tradingDate" DATE NOT NULL,
    "previousCloseVwap" DECIMAL(18,4),
    "openPrice" DECIMAL(18,4),
    "lastTransactionPrice" DECIMAL(18,4),
    "closeVwap" DECIMAL(18,4) NOT NULL,
    "priceChange" DECIMAL(18,4),
    "yearHigh" DECIMAL(18,4),
    "yearLow" DECIMAL(18,4),
    "closingBid" DECIMAL(18,4),
    "closingOffer" DECIMAL(18,4),
    "volume" BIGINT,
    "valueTradedGhs" DECIMAL(20,2),
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketIndex_code_key" ON "MarketIndex"("code");

-- CreateIndex
CREATE INDEX "MarketIndex_active_idx" ON "MarketIndex"("active");

-- CreateIndex
CREATE INDEX "MarketIndexObservation_marketIndexId_idx" ON "MarketIndexObservation"("marketIndexId");

-- CreateIndex
CREATE INDEX "MarketIndexObservation_observationDate_idx" ON "MarketIndexObservation"("observationDate");

-- CreateIndex
CREATE INDEX "MarketIndexObservation_sourceId_idx" ON "MarketIndexObservation"("sourceId");

-- CreateIndex
CREATE INDEX "MarketIndexObservation_ingestionRunId_idx" ON "MarketIndexObservation"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketIndexObservation_marketIndexId_observationDate_key" ON "MarketIndexObservation"("marketIndexId", "observationDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSummary_tradingDate_key" ON "MarketSummary"("tradingDate");

-- CreateIndex
CREATE INDEX "MarketSummary_sourceId_idx" ON "MarketSummary"("sourceId");

-- CreateIndex
CREATE INDEX "MarketSummary_ingestionRunId_idx" ON "MarketSummary"("ingestionRunId");

-- CreateIndex
CREATE INDEX "Company_active_idx" ON "Company"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Security_ticker_key" ON "Security"("ticker");

-- CreateIndex
CREATE INDEX "Security_companyId_idx" ON "Security"("companyId");

-- CreateIndex
CREATE INDEX "Security_active_idx" ON "Security"("active");

-- CreateIndex
CREATE INDEX "SecurityPrice_securityId_idx" ON "SecurityPrice"("securityId");

-- CreateIndex
CREATE INDEX "SecurityPrice_tradingDate_idx" ON "SecurityPrice"("tradingDate");

-- CreateIndex
CREATE INDEX "SecurityPrice_sourceId_idx" ON "SecurityPrice"("sourceId");

-- CreateIndex
CREATE INDEX "SecurityPrice_ingestionRunId_idx" ON "SecurityPrice"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityPrice_securityId_tradingDate_key" ON "SecurityPrice"("securityId", "tradingDate");

-- AddForeignKey
ALTER TABLE "MarketIndexObservation" ADD CONSTRAINT "MarketIndexObservation_marketIndexId_fkey" FOREIGN KEY ("marketIndexId") REFERENCES "MarketIndex"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketIndexObservation" ADD CONSTRAINT "MarketIndexObservation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketIndexObservation" ADD CONSTRAINT "MarketIndexObservation_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSummary" ADD CONSTRAINT "MarketSummary_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSummary" ADD CONSTRAINT "MarketSummary_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Security" ADD CONSTRAINT "Security_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityPrice" ADD CONSTRAINT "SecurityPrice_securityId_fkey" FOREIGN KEY ("securityId") REFERENCES "Security"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityPrice" ADD CONSTRAINT "SecurityPrice_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityPrice" ADD CONSTRAINT "SecurityPrice_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
