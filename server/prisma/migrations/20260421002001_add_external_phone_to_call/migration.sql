-- DropForeignKey
ALTER TABLE "public"."Call" DROP CONSTRAINT "Call_calleeId_fkey";

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "externalPhone" TEXT,
ALTER COLUMN "calleeId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Call_externalPhone_idx" ON "Call"("externalPhone");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
