-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SmsThread" ADD COLUMN     "archivedAt" TIMESTAMP(3);
