CREATE TYPE "NumberRegulatoryStatus" AS ENUM (
  'NOT_STARTED',
  'DRAFT',
  'PENDING_REVIEW',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED'
);

CREATE TABLE "NumberRegulatoryProfile" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'twilio',
  "isoCountry" VARCHAR(2) NOT NULL,
  "numberType" TEXT NOT NULL,
  "endUserType" TEXT NOT NULL,
  "regulationSid" TEXT,
  "bundleSid" TEXT,
  "endUserSid" TEXT,
  "status" "NumberRegulatoryStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "providerStatus" TEXT,
  "rejectionReason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NumberRegulatoryProfile_pkey"
    PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX
  "NumberRegulatoryProfile_bundleSid_key"
  ON "NumberRegulatoryProfile"("bundleSid");

CREATE UNIQUE INDEX
  "NumberRegulatoryProfile_userId_provider_isoCountry_numberType_endUserType_key"
  ON "NumberRegulatoryProfile"(
    "userId",
    "provider",
    "isoCountry",
    "numberType",
    "endUserType"
  );

CREATE INDEX
  "NumberRegulatoryProfile_userId_status_idx"
  ON "NumberRegulatoryProfile"("userId", "status");

CREATE INDEX
  "NumberRegulatoryProfile_regulationSid_idx"
  ON "NumberRegulatoryProfile"("regulationSid");

ALTER TABLE "NumberRegulatoryProfile"
ADD CONSTRAINT "NumberRegulatoryProfile_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
