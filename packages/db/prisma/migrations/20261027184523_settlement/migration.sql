-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'PAYOUT_STATEMENT', 'STATEMENT');

-- CreateEnum
CREATE TYPE "DocumentLineKind" AS ENUM ('FUNDED_SHARE', 'OWED_BY_FUNDER', 'OWN_CONTRIBUTION');

-- DropForeignKey
ALTER TABLE "InvoiceLine" DROP CONSTRAINT "InvoiceLine_invoiceId_fkey";

-- DropIndex
DROP INDEX "Invoice_partnerId_currency_periodStart_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "country" "Country" NOT NULL,
ADD COLUMN     "paymentRef" TEXT,
ADD COLUMN     "type" "DocumentType" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "voidReason" TEXT,
ALTER COLUMN "number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InvoiceLine" DROP COLUMN "grossDiscountMinor",
DROP COLUMN "partnerShareMinor",
DROP COLUMN "refundedDiscountMinor",
ADD COLUMN     "campaignName" TEXT NOT NULL,
ADD COLUMN     "counterpartyName" TEXT,
ADD COLUMN     "counterpartyPartnerId" TEXT,
ADD COLUMN     "grossMinor" BIGINT NOT NULL,
ADD COLUMN     "kind" "DocumentLineKind" NOT NULL,
ADD COLUMN     "netMinor" BIGINT NOT NULL,
ADD COLUMN     "reversedMinor" BIGINT NOT NULL;

-- CreateTable
CREATE TABLE "SettlementEntry" (
    "id" TEXT NOT NULL,
    "redemptionEventId" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "settlementMode" "SettlementMode" NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerType" "PartnerType" NOT NULL,
    "merchantPartnerId" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "countDelta" INTEGER NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "funderDocumentId" TEXT,
    "merchantDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "prefix" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("prefix","country","year")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SettlementEntry_country_eventAt_idx" ON "SettlementEntry"("country", "eventAt");

-- CreateIndex
CREATE INDEX "SettlementEntry_partnerId_eventAt_idx" ON "SettlementEntry"("partnerId", "eventAt");

-- CreateIndex
CREATE INDEX "SettlementEntry_merchantPartnerId_eventAt_idx" ON "SettlementEntry"("merchantPartnerId", "eventAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementEntry_redemptionEventId_partnerId_key" ON "SettlementEntry"("redemptionEventId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_country_validFrom_key" ON "TaxRate"("country", "validFrom");

-- CreateIndex
CREATE INDEX "Invoice_partnerId_periodStart_idx" ON "Invoice"("partnerId", "periodStart");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Default VAT rates (finance to confirm): Egypt 14%, Saudi Arabia 15%.
INSERT INTO "TaxRate" ("id", "country", "rateBps", "validFrom") VALUES
  (gen_random_uuid(), 'EG', 1400, '2020-01-01'),
  (gen_random_uuid(), 'SA', 1500, '2020-01-01');
