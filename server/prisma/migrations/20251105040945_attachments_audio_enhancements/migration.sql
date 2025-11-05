-- AlterTable
ALTER TABLE "MessageAttachment" ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "waveform" JSONB;

-- CreateIndex
CREATE INDEX "MessageAttachment_kind_messageId_idx" ON "MessageAttachment"("kind", "messageId");
