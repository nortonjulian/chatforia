-- CreateTable
CREATE TABLE "ThreadClear" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "chatRoomId" INTEGER NOT NULL,
    "clearedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThreadClear_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThreadClear_chatRoomId_idx" ON "ThreadClear"("chatRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadClear_userId_chatRoomId_key" ON "ThreadClear"("userId", "chatRoomId");
