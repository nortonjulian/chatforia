/*
  Warnings:

  - You are about to drop the column `packKind` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `quantityMb` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `stripePaymentIntent` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSessionId` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - Added the required column `addonKind` to the `MobileDataPackPurchase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `kind` to the `MobileDataPackPurchase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `remainingDataMb` to the `MobileDataPackPurchase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalDataMb` to the `MobileDataPackPurchase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "MobileDataPackPurchase" DROP COLUMN "packKind",
DROP COLUMN "quantityMb",
DROP COLUMN "status",
DROP COLUMN "stripePaymentIntent",
DROP COLUMN "stripeSessionId",
ADD COLUMN     "addonKind" TEXT NOT NULL,
ADD COLUMN     "kind" TEXT NOT NULL,
ADD COLUMN     "provisioningError" TEXT,
ADD COLUMN     "qrCodeSvg" TEXT,
ADD COLUMN     "remainingDataMb" INTEGER NOT NULL,
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripePaymentIntentId" TEXT,
ADD COLUMN     "tealIccid" TEXT,
ADD COLUMN     "tealProfileId" TEXT,
ADD COLUMN     "totalDataMb" INTEGER NOT NULL;
