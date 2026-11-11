-- Persist voicemail email work before acknowledging the recording callback.
-- A string primary key avoids a runtime sequence grant.
CREATE TABLE public."VoicemailEmailDelivery" (
  "voicemailId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "recipient" VARCHAR(255) NOT NULL,
  "fromDisplayName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoicemailEmailDelivery_pkey" PRIMARY KEY ("voicemailId")
);

CREATE INDEX "VoicemailEmailDelivery_status_nextAttemptAt_idx"
  ON public."VoicemailEmailDelivery" ("status", "nextAttemptAt");
CREATE INDEX "VoicemailEmailDelivery_leaseUntil_idx"
  ON public."VoicemailEmailDelivery" ("leaseUntil");

ALTER TABLE public."VoicemailEmailDelivery"
  ADD CONSTRAINT "VoicemailEmailDelivery_voicemailId_fkey"
  FOREIGN KEY ("voicemailId") REFERENCES public."Voicemail"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON public."VoicemailEmailDelivery" TO chatforia_dev;
GRANT UPDATE ("forwardedToEmailAt") ON public."Voicemail" TO chatforia_dev;
