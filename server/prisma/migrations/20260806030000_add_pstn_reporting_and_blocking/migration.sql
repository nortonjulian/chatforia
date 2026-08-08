-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "reportType" TEXT NOT NULL DEFAULT 'APP',
ADD COLUMN     "reportedPhone" VARCHAR(32),
ADD COLUMN     "smsMessageId" INTEGER,
ALTER COLUMN "messageId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SmsBlockedNumber" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsBlockedNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsBlockedNumber_userId_createdAt_idx" ON "SmsBlockedNumber"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsBlockedNumber_phone_idx" ON "SmsBlockedNumber"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SmsBlockedNumber_userId_phone_key" ON "SmsBlockedNumber"("userId", "phone");

-- CreateIndex
CREATE INDEX "Report_reportType_status_createdAt_idx" ON "Report"("reportType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_smsMessageId_reporterId_status_idx" ON "Report"("smsMessageId", "reporterId", "status");

-- CreateIndex
CREATE INDEX "Report_reportedPhone_createdAt_idx" ON "Report"("reportedPhone", "createdAt");

-- AddForeignKey
ALTER TABLE "SmsBlockedNumber" ADD CONSTRAINT "SmsBlockedNumber_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_smsMessageId_fkey" FOREIGN KEY ("smsMessageId") REFERENCES "SmsMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
