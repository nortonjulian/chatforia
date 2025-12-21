-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "mediaUrls" JSONB,
ADD COLUMN     "providerMessageId" VARCHAR(128);

-- CreateIndex
CREATE INDEX "SmsMessage_threadId_idx" ON "SmsMessage"("threadId");

-- CreateIndex
CREATE INDEX "SmsMessage_providerMessageId_idx" ON "SmsMessage"("providerMessageId");
