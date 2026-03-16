/*
  Warnings:

  - A unique constraint covering the columns `[userId,deviceId]` on the table `Device` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `deviceId` to the `Device` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Device` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "deviceId" TEXT NOT NULL,
ADD COLUMN     "keyAlgorithm" TEXT NOT NULL DEFAULT 'curve25519',
ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "Device_userId_revokedAt_idx" ON "Device"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_deviceId_key" ON "Device"("userId", "deviceId");
