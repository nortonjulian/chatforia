-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "clearedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "part_user_cleared" ON "Participant"("userId", "clearedAt");
