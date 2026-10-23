-- Restore schema parity after the 2026-10-23 account-blocking test baseline.
-- Additive only: retain existing users, calls, chat rooms, and Ria preferences.
-- The historical "foriaRemember" database column is preserved by Prisma @map.

-- Random Chat lifecycle metadata and the optional backing conversation.
ALTER TABLE "RandomChatRoom"
  ADD COLUMN IF NOT EXISTS "chatRoomId" INTEGER,
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endedById" INTEGER,
  ADD COLUMN IF NOT EXISTS "endedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "unlockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "RandomChatRoom_chatRoomId_key"
  ON "RandomChatRoom" ("chatRoomId");

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"RandomChatRoom"'::regclass
      AND conname = 'RandomChatRoom_chatRoomId_fkey'
  ) THEN
    ALTER TABLE "RandomChatRoom"
      ADD CONSTRAINT "RandomChatRoom_chatRoomId_fkey"
      FOREIGN KEY ("chatRoomId") REFERENCES "ChatRoom"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- Persist the call participants already represented in the Prisma schema.
CREATE TABLE IF NOT EXISTS "CallParticipant" (
  "id" SERIAL NOT NULL,
  "callId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "status" TEXT NOT NULL DEFAULT 'RINGING',
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CallParticipant_callId_idx"
  ON "CallParticipant"("callId");
CREATE INDEX IF NOT EXISTS "CallParticipant_userId_idx"
  ON "CallParticipant"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "CallParticipant_callId_userId_key"
  ON "CallParticipant"("callId", "userId");

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"CallParticipant"'::regclass
      AND conname = 'CallParticipant_callId_fkey'
  ) THEN
    ALTER TABLE "CallParticipant"
      ADD CONSTRAINT "CallParticipant_callId_fkey"
      FOREIGN KEY ("callId") REFERENCES "Call"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"CallParticipant"'::regclass
      AND conname = 'CallParticipant_userId_fkey'
  ) THEN
    ALTER TABLE "CallParticipant"
      ADD CONSTRAINT "CallParticipant_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$migration$;

-- Rename the regulatory-profile index to match the current Prisma schema.
-- Conditional because existing deployments may already have the final name.
DO $migration$
BEGIN
  IF to_regclass('public."NumberRegulatoryProfile_userId_provider_isoCountry_numberType_e"') IS NOT NULL
    AND to_regclass('public."NumberRegulatoryProfile_userId_provider_isoCountry_numberTy_key"') IS NULL
  THEN
    ALTER INDEX "NumberRegulatoryProfile_userId_provider_isoCountry_numberType_e"
      RENAME TO "NumberRegulatoryProfile_userId_provider_isoCountry_numberTy_key";
  END IF;
END
$migration$;
