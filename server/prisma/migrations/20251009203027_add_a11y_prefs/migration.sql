-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "a11yCaptionMaxLines" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "a11yCaptionPosition" TEXT NOT NULL DEFAULT 'bottom',
ADD COLUMN     "a11yStoreTranscripts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "a11yTranscriptRetentionDays" INTEGER;
