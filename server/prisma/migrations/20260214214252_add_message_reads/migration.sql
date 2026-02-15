/*
  Warnings:

  - A unique constraint covering the columns `[chatRoomId,senderId,clientMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."Message_clientMessageId_key";

-- DropIndex
DROP INDEX "public"."MessageSessionKey_messageId_idx";

-- CreateTable
CREATE TABLE "MessageRead" (
    "messageId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateIndex
CREATE INDEX "MessageRead_userId_readAt_idx" ON "MessageRead"("userId", "readAt");

-- CreateIndex
CREATE INDEX "MessageRead_messageId_idx" ON "MessageRead"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "msg_client_idempotency" ON "Message"("chatRoomId", "senderId", "clientMessageId");

-- CreateIndex
CREATE INDEX "MessageSessionKey_messageId_recipientUserId_idx" ON "MessageSessionKey"("messageId", "recipientUserId");

-- AddForeignKey
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
