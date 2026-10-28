-- CreateEnum
CREATE TYPE "Country" AS ENUM ('EG', 'SA');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('EGP', 'SAR');

-- CreateEnum
CREATE TYPE "CardScheme" AS ENUM ('VISA', 'MASTERCARD', 'MEEZA', 'MADA', 'AMEX');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('BANK', 'MERCHANT', 'WAFFARHA');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED', 'TIERED');

-- CreateEnum
CREATE TYPE "LimitPeriod" AS ENUM ('DAY', 'WEEK', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RedemptionEventType" AS ENUM ('RESERVED', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CAMPAIGN_MANAGER', 'APPROVER', 'FINANCE', 'VIEWER', 'PARTNER_USER');

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "type" "PartnerType" NOT NULL,
    "country" "Country" NOT NULL,
    "taxNumber" TEXT,
    "billingEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "country" "Country" NOT NULL,
    "mcc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" TEXT NOT NULL,
    "acquirerId" TEXT NOT NULL,
    "externalTerminalId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "branchId" TEXT,
    "mcc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acquirer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" "Country" NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "hmacSecretEnc" TEXT NOT NULL,
    "certFingerprint" TEXT,
    "ipAllowlist" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Acquirer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "country" "Country" NOT NULL,
    "currency" "Currency" NOT NULL,
    "timezone" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountConfig" JSONB NOT NULL,
    "targeting" JSONB NOT NULL,
    "schedule" JSONB,
    "displayMessage" TEXT,
    "displayMessageAr" TEXT,
    "totalBudgetMinor" BIGINT,
    "maxUniqueCards" INTEGER,
    "dailyBudgetMinor" BIGINT,
    "dailyRedemptionLimit" INTEGER,
    "perCardMaxCount" INTEGER,
    "perCardMaxAmountMinor" BIGINT,
    "perCardPeriod" "LimitPeriod",
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVersion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignFunding" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "shareBps" INTEGER NOT NULL,

    CONSTRAINT "CampaignFunding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "acquirerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "acquirerTxnRef" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignVersion" INTEGER NOT NULL,
    "terminalId" TEXT NOT NULL,
    "cardTokenHash" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "scheme" "CardScheme" NOT NULL,
    "currency" "Currency" NOT NULL,
    "originalAmountMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "finalAmountMinor" BIGINT NOT NULL,
    "refundedDiscountMinor" BIGINT NOT NULL DEFAULT 0,
    "refundedAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "fundingSnapshot" JSONB NOT NULL,
    "counterKeys" JSONB NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "authCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionEvent" (
    "id" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "type" "RedemptionEventType" NOT NULL,
    "discountDeltaMinor" BIGINT NOT NULL,
    "amountMinor" BIGINT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryLog" (
    "id" TEXT NOT NULL,
    "acquirerId" TEXT NOT NULL,
    "terminalId" TEXT,
    "acquirerTxnRef" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "campaignId" TEXT,
    "redemptionId" TEXT,
    "reason" TEXT,
    "details" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InquiryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "vatBps" INTEGER NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "redemptionCount" INTEGER NOT NULL,
    "grossDiscountMinor" BIGINT NOT NULL,
    "refundedDiscountMinor" BIGINT NOT NULL,
    "partnerShareMinor" BIGINT NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "partnerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_acquirerId_externalTerminalId_key" ON "Terminal"("acquirerId", "externalTerminalId");

-- CreateIndex
CREATE UNIQUE INDEX "Acquirer_apiKeyId_key" ON "Acquirer"("apiKeyId");

-- CreateIndex
CREATE INDEX "Campaign_status_country_startAt_endAt_idx" ON "Campaign"("status", "country", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_version_key" ON "CampaignVersion"("campaignId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignFunding_campaignId_partnerId_key" ON "CampaignFunding"("campaignId", "partnerId");

-- CreateIndex
CREATE INDEX "Redemption_acquirerId_acquirerTxnRef_idx" ON "Redemption"("acquirerId", "acquirerTxnRef");

-- CreateIndex
CREATE INDEX "Redemption_campaignId_status_idx" ON "Redemption"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Redemption_status_expiresAt_idx" ON "Redemption"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Redemption_cardTokenHash_idx" ON "Redemption"("cardTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_acquirerId_idempotencyKey_key" ON "Redemption"("acquirerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RedemptionEvent_redemptionId_idx" ON "RedemptionEvent"("redemptionId");

-- CreateIndex
CREATE INDEX "InquiryLog_createdAt_idx" ON "InquiryLog"("createdAt");

-- CreateIndex
CREATE INDEX "InquiryLog_campaignId_createdAt_idx" ON "InquiryLog"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_partnerId_currency_periodStart_key" ON "Invoice"("partnerId", "currency", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_acquirerId_fkey" FOREIGN KEY ("acquirerId") REFERENCES "Acquirer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFunding" ADD CONSTRAINT "CampaignFunding_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignFunding" ADD CONSTRAINT "CampaignFunding_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_acquirerId_fkey" FOREIGN KEY ("acquirerId") REFERENCES "Acquirer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionEvent" ADD CONSTRAINT "RedemptionEvent_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "Redemption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
