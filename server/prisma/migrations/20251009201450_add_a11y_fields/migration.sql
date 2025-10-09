-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "a11yUiFont" TEXT NOT NULL DEFAULT 'md',
ALTER COLUMN "a11yVibrate" SET DEFAULT false,
ALTER COLUMN "a11yVisualAlerts" SET DEFAULT false,
ALTER COLUMN "a11yVoiceNoteSTT" SET DEFAULT false;
