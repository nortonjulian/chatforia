ALTER TABLE "NumberReservation"
ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LEGACY_SELECTION';

CREATE INDEX "NumberReservation_phoneNumberId_purpose_expiresAt_idx"
ON "NumberReservation"("phoneNumberId", "purpose", "expiresAt");

CREATE INDEX "NumberReservation_userId_purpose_expiresAt_idx"
ON "NumberReservation"("userId", "purpose", "expiresAt");
