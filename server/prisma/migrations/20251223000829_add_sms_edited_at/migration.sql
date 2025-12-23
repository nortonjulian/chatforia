-- AlterTable
ALTER TABLE "SmsThread" ADD COLUMN     "contactId" INTEGER,
ADD COLUMN     "contactPhone" VARCHAR(32);

-- AddForeignKey
ALTER TABLE "SmsThread" ADD CONSTRAINT "SmsThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
