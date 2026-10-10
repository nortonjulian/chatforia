-- PSTN usage idempotency on canonical Call rows.
ALTER TABLE "Call"
ADD COLUMN "pstnUsageChargedSec" INTEGER NOT NULL DEFAULT 0;

-- Durable idempotency ledger for call-forwarding callbacks.
CREATE TABLE "VoiceUsageCharge" (
    "id" SERIAL NOT NULL,
    "eventKey" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "meter" TEXT NOT NULL,
    "seconds" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceUsageCharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VoiceUsageCharge_eventKey_key"
ON "VoiceUsageCharge"("eventKey");

CREATE INDEX "VoiceUsageCharge_userId_createdAt_idx"
ON "VoiceUsageCharge"("userId", "createdAt");

CREATE INDEX "VoiceUsageCharge_meter_createdAt_idx"
ON "VoiceUsageCharge"("meter", "createdAt");

ALTER TABLE "VoiceUsageCharge"
ADD CONSTRAINT "VoiceUsageCharge_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
