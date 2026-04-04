/*
  Warnings:

  - You are about to drop the column `stripeCustomerId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[billingSubscriptionId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."User_stripeCustomerId_key";

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "pairingApprovedAt" TIMESTAMP(3),
ADD COLUMN     "pairingRejectedAt" TIMESTAMP(3),
ADD COLUMN     "pairingRequestedAt" TIMESTAMP(3),
ADD COLUMN     "pairingStatus" TEXT,
ADD COLUMN     "wrappedAccountKey" TEXT,
ADD COLUMN     "wrappedAccountKeyAlgo" TEXT,
ADD COLUMN     "wrappedAccountKeyVer" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "billingCustomerId" TEXT,
ADD COLUMN     "billingProvider" TEXT,
ADD COLUMN     "billingSubscriptionId" TEXT,
ADD COLUMN     "subscriptionEndsAt" TIMESTAMP(3),
ADD COLUMN     "subscriptionStatus" TEXT NOT NULL DEFAULT 'INACTIVE',
ALTER COLUMN "messageTone" SET DEFAULT 'Default.mp3',
ALTER COLUMN "ringtone" SET DEFAULT 'Classic.mp3';

-- CreateIndex
CREATE INDEX "Device_userId_pairingStatus_idx" ON "Device"("userId", "pairingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "User_billingSubscriptionId_key" ON "User"("billingSubscriptionId");
