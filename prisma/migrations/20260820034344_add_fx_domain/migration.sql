-- AlterEnum
ALTER TYPE "IngestionMethod" ADD VALUE 'HTML_FETCH';

-- CreateTable
CREATE TABLE "CurrencyPair" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currencyPairId" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "buyingRate" DECIMAL(18,6),
    "sellingRate" DECIMAL(18,6),
    "midRate" DECIMAL(18,6) NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyPair_code_key" ON "CurrencyPair"("code");

-- CreateIndex
CREATE INDEX "CurrencyPair_active_idx" ON "CurrencyPair"("active");

-- CreateIndex
CREATE INDEX "ExchangeRate_currencyPairId_idx" ON "ExchangeRate"("currencyPairId");

-- CreateIndex
CREATE INDEX "ExchangeRate_observationDate_idx" ON "ExchangeRate"("observationDate");

-- CreateIndex
CREATE INDEX "ExchangeRate_sourceId_idx" ON "ExchangeRate"("sourceId");

-- CreateIndex
CREATE INDEX "ExchangeRate_ingestionRunId_idx" ON "ExchangeRate"("ingestionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_currencyPairId_observationDate_key" ON "ExchangeRate"("currencyPairId", "observationDate");

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_currencyPairId_fkey" FOREIGN KEY ("currencyPairId") REFERENCES "CurrencyPair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "IngestionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
