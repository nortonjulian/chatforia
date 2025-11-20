/*
  Warnings:

  - You are about to drop the column `createdAt` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `gb` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `packCode` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `stripePaymentIntentId` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - Added the required column `packKind` to the `MobileDataPackPurchase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `quantityMb` to the `MobileDataPackPurchase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MobileDataPackPurchase" DROP COLUMN "createdAt",
DROP COLUMN "gb",
DROP COLUMN "packCode",
DROP COLUMN "stripePaymentIntentId",
ADD COLUMN     "packKind" TEXT NOT NULL,
ADD COLUMN     "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "quantityMb" INTEGER NOT NULL,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "stripePaymentIntent" TEXT,
ALTER COLUMN "stripeSessionId" DROP NOT NULL,
ALTER COLUMN "expiresAt" DROP NOT NULL;
