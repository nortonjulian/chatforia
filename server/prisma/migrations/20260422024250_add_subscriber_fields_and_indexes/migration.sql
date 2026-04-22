-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN     "esimProfileId" TEXT,
ADD COLUMN     "externalSubscriberId" TEXT,
ADD COLUMN     "purchaseId" INTEGER;

-- CreateIndex
CREATE INDEX "MobileDataPackPurchase_userId_purchasedAt_idx" ON "MobileDataPackPurchase"("userId", "purchasedAt");

-- CreateIndex
CREATE INDEX "MobileDataPackPurchase_userId_expiresAt_idx" ON "MobileDataPackPurchase"("userId", "expiresAt");
