-- AlterTable
ALTER TABLE "Voicemail" ADD COLUMN     "relatedCallId" INTEGER;

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_relatedCallId_fkey" FOREIGN KEY ("relatedCallId") REFERENCES "Call"("id") ON DELETE SET NULL ON UPDATE CASCADE;
