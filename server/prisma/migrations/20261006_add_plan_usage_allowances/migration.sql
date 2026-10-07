CREATE TABLE "PlanUsage" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "monthKey" TEXT NOT NULL,
    "riaActions" INTEGER NOT NULL DEFAULT 0,
    "translationChars" INTEGER NOT NULL DEFAULT 0,
    "hostedParticipantSeconds" INTEGER NOT NULL DEFAULT 0,
    "smsMessages" INTEGER NOT NULL DEFAULT 0,
    "pstnSeconds" INTEGER NOT NULL DEFAULT 0,
    "forwardingSeconds" INTEGER NOT NULL DEFAULT 0,
    "voicemailTranscriptionSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanUsage_userId_monthKey_key"
ON "PlanUsage"("userId", "monthKey");

CREATE INDEX "PlanUsage_monthKey_idx"
ON "PlanUsage"("monthKey");

CREATE INDEX "PlanUsage_userId_updatedAt_idx"
ON "PlanUsage"("userId", "updatedAt");

ALTER TABLE "PlanUsage"
ADD CONSTRAINT "PlanUsage_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
