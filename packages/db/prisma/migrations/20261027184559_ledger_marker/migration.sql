-- AlterTable
ALTER TABLE "RedemptionEvent" ADD COLUMN     "ledgerProcessedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RedemptionEvent_ledgerProcessedAt_type_idx" ON "RedemptionEvent"("ledgerProcessedAt", "type");

