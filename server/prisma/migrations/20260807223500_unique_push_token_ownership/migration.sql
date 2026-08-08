BEGIN;

-- A push token identifies one app installation and may belong to only
-- one Device row, regardless of which account previously used it.
CREATE UNIQUE INDEX "Device_pushToken_key"
ON "Device"("pushToken");

CREATE UNIQUE INDEX "Device_apnsPushToken_key"
ON "Device"("apnsPushToken");

CREATE UNIQUE INDEX "Device_apnsSandboxPushToken_key"
ON "Device"("apnsSandboxPushToken");

CREATE UNIQUE INDEX "Device_fcmPushToken_key"
ON "Device"("fcmPushToken");

CREATE UNIQUE INDEX "Device_voipPushToken_key"
ON "Device"("voipPushToken");

CREATE UNIQUE INDEX "Device_voipSandboxPushToken_key"
ON "Device"("voipSandboxPushToken");

-- The unique indexes replace these non-unique indexes.
DROP INDEX "Device_apnsPushToken_idx";
DROP INDEX "Device_apnsSandboxPushToken_idx";
DROP INDEX "Device_fcmPushToken_idx";
DROP INDEX "Device_voipPushToken_idx";
DROP INDEX "Device_voipSandboxPushToken_idx";

COMMIT;
