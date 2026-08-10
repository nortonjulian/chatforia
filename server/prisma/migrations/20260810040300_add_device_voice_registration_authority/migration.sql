ALTER TABLE "Device"
ADD COLUMN "voiceIdentity" TEXT,
ADD COLUMN "voiceRegisteredAt" TIMESTAMP(3),
ADD COLUMN "voiceRegistrationVer" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "voicePushEnvironment" TEXT;

CREATE UNIQUE INDEX "Device_voiceIdentity_key"
ON "Device"("voiceIdentity");
