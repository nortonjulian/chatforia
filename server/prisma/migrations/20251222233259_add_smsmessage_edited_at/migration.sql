/*
  Warnings:

  - You are about to drop the column `contactPhone` on the `SmsThread` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."SmsThread_userId_contactPhone_key";

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SmsThread" DROP COLUMN "contactPhone";

-- CreateTable
CREATE TABLE "SmsParticipant" (
    "id" SERIAL NOT NULL,
    "threadId" INTEGER NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsParticipant_phone_idx" ON "SmsParticipant"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SmsParticipant_threadId_phone_key" ON "SmsParticipant"("threadId", "phone");

-- AddForeignKey
ALTER TABLE "SmsParticipant" ADD CONSTRAINT "SmsParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SmsThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
