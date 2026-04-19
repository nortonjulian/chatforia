/*
  Warnings:

  - A unique constraint covering the columns `[billingTransactionId]` on the table `MobileDataPackPurchase` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MobileDataPackPurchase" ADD COLUMN     "billingTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MobileDataPackPurchase_billingTransactionId_key" ON "MobileDataPackPurchase"("billingTransactionId");
