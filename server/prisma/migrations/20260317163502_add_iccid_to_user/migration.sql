/*
  Warnings:

  - You are about to drop the column `tealIccid` on the `MobileDataPackPurchase` table. All the data in the column will be lost.
  - You are about to drop the column `tealIccid` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "MobileDataPackPurchase" DROP COLUMN "tealIccid",
ADD COLUMN     "iccid" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "blockApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "chatRoomId" INTEGER,
ADD COLUMN     "details" TEXT,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "reportedUserId" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "tealIccid",
ADD COLUMN     "encryptedPrivateKeyBundle" TEXT,
ADD COLUMN     "iccid" TEXT,
ADD COLUMN     "privateKeyWrapIterations" INTEGER,
ADD COLUMN     "privateKeyWrapKdf" TEXT,
ADD COLUMN     "privateKeyWrapSalt" TEXT,
ADD COLUMN     "privateKeyWrapVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Report_reporterId_createdAt_idx" ON "Report"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reportedUserId_createdAt_idx" ON "Report"("reportedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_chatRoomId_createdAt_idx" ON "Report"("chatRoomId", "createdAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
