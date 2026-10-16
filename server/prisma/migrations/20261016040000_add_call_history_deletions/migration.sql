-- CreateTable
CREATE TABLE "CallHistoryDeletion" (
    "id" SERIAL NOT NULL,
    "callId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallHistoryDeletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallHistoryDeletion_callId_userId_key"
ON "CallHistoryDeletion"("callId", "userId");

-- CreateIndex
CREATE INDEX "CallHistoryDeletion_userId_createdAt_idx"
ON "CallHistoryDeletion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CallHistoryDeletion_callId_idx"
ON "CallHistoryDeletion"("callId");

-- AddForeignKey
ALTER TABLE "CallHistoryDeletion"
ADD CONSTRAINT "CallHistoryDeletion_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "Call"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallHistoryDeletion"
ADD CONSTRAINT "CallHistoryDeletion_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
