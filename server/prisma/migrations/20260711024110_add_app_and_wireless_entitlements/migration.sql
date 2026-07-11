CREATE TABLE "AppSubscription" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerSubscriptionKey" TEXT NOT NULL,
    "customerReference" TEXT,
    "productId" TEXT NOT NULL,
    "basePlanId" TEXT,
    "plan" "Plan" NOT NULL,
    "status" TEXT NOT NULL,
    "grantsAccess" BOOLEAN NOT NULL DEFAULT false,
    "autoRenewEnabled" BOOLEAN,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WirelessEntitlement" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "externalReference" TEXT,
    "status" TEXT NOT NULL,
    "grantsAccess" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "provisioningStatus" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WirelessEntitlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppSubscription_provider_providerSubscriptionKey_key"
ON "AppSubscription"("provider", "providerSubscriptionKey");

CREATE INDEX "AppSubscription_userId_grantsAccess_endsAt_idx"
ON "AppSubscription"("userId", "grantsAccess", "endsAt");

CREATE INDEX "AppSubscription_provider_status_idx"
ON "AppSubscription"("provider", "status");

CREATE INDEX "WirelessEntitlement_userId_grantsAccess_endsAt_idx"
ON "WirelessEntitlement"("userId", "grantsAccess", "endsAt");

CREATE INDEX "WirelessEntitlement_provider_status_idx"
ON "WirelessEntitlement"("provider", "status");

CREATE INDEX "WirelessEntitlement_externalReference_idx"
ON "WirelessEntitlement"("externalReference");

ALTER TABLE "AppSubscription"
ADD CONSTRAINT "AppSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WirelessEntitlement"
ADD CONSTRAINT "WirelessEntitlement_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
