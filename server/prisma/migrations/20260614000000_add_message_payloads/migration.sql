-- CreateTable
CREATE TABLE "MessagePayload" (
    "messageId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "contentCiphertext" JSONB NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "language" TEXT,
    "sourceLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessagePayload_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateIndex
CREATE INDEX "MessagePayload_messageId_idx" ON "MessagePayload"("messageId");

-- CreateIndex
CREATE INDEX "MessagePayload_userId_idx" ON "MessagePayload"("userId");

-- AddForeignKey
ALTER TABLE "MessagePayload" ADD CONSTRAINT "MessagePayload_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessagePayload" ADD CONSTRAINT "MessagePayload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
