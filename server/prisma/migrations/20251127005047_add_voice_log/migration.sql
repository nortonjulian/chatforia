/*
  Warnings:

  - You are about to drop the column `duration` on the `VoiceLog` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `VoiceLog` table. All the data in the column will be lost.
  - Made the column `status` on table `VoiceLog` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "VoiceLog" DROP COLUMN "duration",
DROP COLUMN "updatedAt",
ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "rawPayload" JSONB,
ADD COLUMN     "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET NOT NULL;
