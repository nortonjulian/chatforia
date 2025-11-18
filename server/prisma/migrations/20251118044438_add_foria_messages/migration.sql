-- AlterTable
ALTER TABLE "User" ADD COLUMN     "foriaRemember" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ForiaMessage" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForiaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForiaMessage_userId_createdAt_idx" ON "ForiaMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ForiaMessage" ADD CONSTRAINT "ForiaMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
