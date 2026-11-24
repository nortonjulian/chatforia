-- Additive notification authority after the verified 166-migration baseline.
-- Random Chat and MLS migrations are intentionally absent from this package.
CREATE TABLE public."PushInstallation" (
  "id" uuid PRIMARY KEY,
  "proofHash" varchar(64) NOT NULL,
  "platform" varchar(16) NOT NULL,
  "appId" varchar(160) NOT NULL,
  "generation" bigint NOT NULL DEFAULT 0,
  "currentUserId" integer,
  "currentDeviceRowId" text,
  "sessionFingerprint" varchar(64),
  "tokenVersion" integer,
  "issuedAtMs" bigint,
  "highWaterIssuedAtMs" bigint NOT NULL DEFAULT 0,
  "sessionExpiresAt" timestamptz,
  "cleanupHash" varchar(64),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushInstallation_currentUserId_fkey"
    FOREIGN KEY ("currentUserId") REFERENCES public."User"("id") ON DELETE SET NULL,
  CONSTRAINT "PushInstallation_currentDeviceRowId_fkey"
    FOREIGN KEY ("currentDeviceRowId") REFERENCES public."Device"("id") ON DELETE SET NULL,
  CONSTRAINT "PushInstallation_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "PushInstallation_highWater_check" CHECK ("highWaterIssuedAtMs" >= 0)
);

CREATE INDEX "PushInstallation_currentUserId_sessionExpiresAt_idx"
  ON public."PushInstallation" ("currentUserId", "sessionExpiresAt");
CREATE INDEX "PushInstallation_currentDeviceRowId_idx"
  ON public."PushInstallation" ("currentDeviceRowId");

CREATE TABLE public."PushRegistration" (
  "id" uuid PRIMARY KEY,
  "installationId" uuid NOT NULL,
  "generation" bigint NOT NULL,
  "provider" varchar(16) NOT NULL,
  "environment" varchar(16) NOT NULL,
  "token" text,
  "tokenDigest" varchar(64) NOT NULL,
  "tokenRevision" bigint NOT NULL,
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushRegistration_installationId_fkey"
    FOREIGN KEY ("installationId") REFERENCES public."PushInstallation"("id") ON DELETE CASCADE,
  CONSTRAINT "PushRegistration_revision_check" CHECK ("tokenRevision" >= 0),
  CONSTRAINT "PushRegistration_provider_environment_check" CHECK (
    ("provider" IN ('apns', 'apns_voip') AND "environment" IN ('production', 'sandbox'))
    OR ("provider" = 'fcm' AND "environment" = 'none')
  )
);

CREATE INDEX "PushRegistration_installation_generation_revoked_idx"
  ON public."PushRegistration" ("installationId", "generation", "revokedAt");
CREATE UNIQUE INDEX "PushRegistration_active_installation_provider_key"
  ON public."PushRegistration" ("installationId", "provider")
  WHERE "revokedAt" IS NULL;
CREATE UNIQUE INDEX "PushRegistration_active_token_owner_key"
  ON public."PushRegistration" ("provider", "environment", "tokenDigest")
  WHERE "revokedAt" IS NULL;

DO $role_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chatforia_dev') THEN
    RAISE EXCEPTION 'Required restricted runtime role is missing';
  END IF;
END;
$role_check$;

REVOKE ALL ON public."PushInstallation", public."PushRegistration" FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON public."PushInstallation", public."PushRegistration" TO chatforia_dev;
-- No runtime DELETE, TRUNCATE, TRIGGER, REFERENCES, or DDL grant.
