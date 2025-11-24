-- CreateEnum
CREATE TYPE "VoicemailTranscriptStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "voicemailAutoDeleteDays" INTEGER,
ADD COLUMN     "voicemailEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "voicemailForwardEmail" TEXT,
ADD COLUMN     "voicemailGreetingText" TEXT,
ADD COLUMN     "voicemailGreetingUrl" TEXT;

-- CreateTable
CREATE TABLE "Voicemail" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "phoneNumberId" INTEGER,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "durationSec" INTEGER,
    "transcript" TEXT,
    "transcriptStatus" "VoicemailTranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwardedToEmailAt" TIMESTAMP(3),

    CONSTRAINT "Voicemail_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voicemail" ADD CONSTRAINT "Voicemail_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "PhoneNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
