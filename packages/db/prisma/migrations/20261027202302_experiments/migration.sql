-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "experimentSalt" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN     "holdoutBps" INTEGER NOT NULL DEFAULT 0;

-- Existing campaigns got a random salt above; new ones get theirs from Prisma.
ALTER TABLE "Campaign" ALTER COLUMN "experimentSalt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Redemption" ADD COLUMN     "variantKey" TEXT;

-- CreateTable
CREATE TABLE "CampaignVariant" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightBps" INTEGER NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountConfig" JSONB NOT NULL,

    CONSTRAINT "CampaignVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignExposure" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "cardTokenHash" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "merchantPartnerId" TEXT NOT NULL,
    "redemptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignExposure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVariant_campaignId_key_key" ON "CampaignVariant"("campaignId", "key");

-- CreateIndex
CREATE INDEX "CampaignExposure_campaignId_createdAt_idx" ON "CampaignExposure"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignExposure_campaignId_group_cardTokenHash_idx" ON "CampaignExposure"("campaignId", "group", "cardTokenHash");

-- AddForeignKey
ALTER TABLE "CampaignVariant" ADD CONSTRAINT "CampaignVariant_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

