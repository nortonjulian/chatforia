-- Extend Google Play subscription records with durable verification,
-- acknowledgement retry, RTDN, and reconciliation state.
ALTER TABLE "GooglePlaySubscription"
ADD COLUMN "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN "lastVerificationErrorCode" TEXT,
ADD COLUMN "lastVerificationErrorMessage" TEXT,
ADD COLUMN "lastRtdnAt" TIMESTAMP(3),
ADD COLUMN "lastRtdnNotificationType" INTEGER,
ADD COLUMN "accessGrantedSnapshot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "acknowledgementAttemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAcknowledgementAttemptAt" TIMESTAMP(3),
ADD COLUMN "nextAcknowledgementAttemptAt" TIMESTAMP(3),
ADD COLUMN "lastAcknowledgementErrorCode" TEXT,
ADD COLUMN "lastAcknowledgementErrorMessage" TEXT,
ADD COLUMN "revokedAt" TIMESTAMP(3),
ADD COLUMN "supersededAt" TIMESTAMP(3);

-- Store Pub/Sub events independently so delivery is idempotent.
-- Raw purchase tokens are deliberately not stored in this table.
CREATE TABLE "GooglePlayRtdnEvent" (
    "id" TEXT NOT NULL,
    "pubsubMessageId" TEXT NOT NULL,
    "googlePlaySubscriptionId" TEXT,
    "packageName" TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "notificationVersion" TEXT,
    "notificationType" INTEGER,
    "purchaseTokenHash" VARCHAR(64),
    "eventTime" TIMESTAMP(3),
    "publishTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePlayRtdnEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GooglePlayRtdnEvent_pubsubMessageId_key"
ON "GooglePlayRtdnEvent"("pubsubMessageId");

CREATE INDEX "GooglePlayRtdnEvent_status_createdAt_idx"
ON "GooglePlayRtdnEvent"("status", "createdAt");

CREATE INDEX "GooglePlayRtdnEvent_purchaseTokenHash_idx"
ON "GooglePlayRtdnEvent"("purchaseTokenHash");

CREATE INDEX "GooglePlayRtdnEvent_googlePlaySubscriptionId_idx"
ON "GooglePlayRtdnEvent"("googlePlaySubscriptionId");

CREATE INDEX "GooglePlayRtdnEvent_packageName_eventTime_idx"
ON "GooglePlayRtdnEvent"("packageName", "eventTime");

CREATE INDEX "GooglePlaySubscription_lastVerifiedAt_idx"
ON "GooglePlaySubscription"("lastVerifiedAt");

CREATE INDEX "GooglePlaySubscription_subscriptionState_lastVerifiedAt_idx"
ON "GooglePlaySubscription"("subscriptionState", "lastVerifiedAt");

CREATE INDEX "GooglePlaySubscription_acknowledgementState_nextAcknowledgementAttemptAt_idx"
ON "GooglePlaySubscription"(
    "acknowledgementState",
    "nextAcknowledgementAttemptAt"
);

ALTER TABLE "GooglePlayRtdnEvent"
ADD CONSTRAINT "GooglePlayRtdnEvent_googlePlaySubscriptionId_fkey"
FOREIGN KEY ("googlePlaySubscriptionId")
REFERENCES "GooglePlaySubscription"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
