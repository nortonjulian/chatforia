/*
  Warnings:

  - The values [ANSWERED,REJECTED,CANCELLED] on the enum `CallStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[twilioCallSid]` on the table `Call` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "CallStatus_new" AS ENUM ('INITIATED', 'RINGING', 'ACTIVE', 'DECLINED', 'MISSED', 'FAILED', 'ENDED');
ALTER TABLE "public"."Call" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Call" ALTER COLUMN "status" TYPE "CallStatus_new" USING ("status"::text::"CallStatus_new");
ALTER TYPE "CallStatus" RENAME TO "CallStatus_old";
ALTER TYPE "CallStatus_new" RENAME TO "CallStatus";
DROP TYPE "public"."CallStatus_old";
ALTER TABLE "Call" ALTER COLUMN "status" SET DEFAULT 'RINGING';
COMMIT;

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "fromLabel" TEXT,
ADD COLUMN     "toLabel" TEXT,
ADD COLUMN     "twilioCallSid" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "displayName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Call_twilioCallSid_key" ON "Call"("twilioCallSid");
