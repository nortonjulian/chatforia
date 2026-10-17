-- The original push-token fields were introduced outside the recorded
-- migration history. Restore them before the unique-index migration so a
-- fresh database can replay that history. These checks also make this safe
-- for databases where the fields and unique indexes already exist.
ALTER TABLE "Device"
  ADD COLUMN IF NOT EXISTS "apnsPushToken" TEXT,
  ADD COLUMN IF NOT EXISTS "fcmPushToken" TEXT,
  ADD COLUMN IF NOT EXISTS "voipPushToken" TEXT;

DO $$
BEGIN
  IF to_regclass('public."Device_apnsPushToken_key"') IS NULL THEN
    CREATE INDEX IF NOT EXISTS "Device_apnsPushToken_idx" ON "Device"("apnsPushToken");
  END IF;
  IF to_regclass('public."Device_fcmPushToken_key"') IS NULL THEN
    CREATE INDEX IF NOT EXISTS "Device_fcmPushToken_idx" ON "Device"("fcmPushToken");
  END IF;
  IF to_regclass('public."Device_voipPushToken_key"') IS NULL THEN
    CREATE INDEX IF NOT EXISTS "Device_voipPushToken_idx" ON "Device"("voipPushToken");
  END IF;
END $$;
