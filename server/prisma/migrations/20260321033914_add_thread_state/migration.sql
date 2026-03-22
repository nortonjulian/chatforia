/*
  Warnings:

  - You are about to drop the `ThreadClear` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "isHiddenByModeration" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moderationStatus" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "aiCategory" TEXT,
ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "autoHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "recommendedAction" TEXT,
ADD COLUMN     "reviewedByAiAt" TIMESTAMP(3),
ADD COLUMN     "scoreFactors" JSONB,
ADD COLUMN     "severityScore" DOUBLE PRECISION;

-- DropTable
DROP TABLE "public"."ThreadClear";

-- CreateTable
CREATE TABLE "ThreadState" (
    "userId" INTEGER NOT NULL,
    "chatRoomId" INTEGER NOT NULL,
    "deletedAt" TIMESTAMP(3)
);

-- CreateIndex
CREATE UNIQUE INDEX "ThreadState_userId_chatRoomId_key" ON "ThreadState"("userId", "chatRoomId");

-- CreateIndex
CREATE INDEX "Report_priority_createdAt_idx" ON "Report"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "Report_severityScore_createdAt_idx" ON "Report"("severityScore", "createdAt");

-- CreateIndex
CREATE INDEX "Report_autoHidden_createdAt_idx" ON "Report"("autoHidden", "createdAt");

-- AddForeignKey
ALTER TABLE "ThreadState" ADD CONSTRAINT "ThreadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadState" ADD CONSTRAINT "ThreadState_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
