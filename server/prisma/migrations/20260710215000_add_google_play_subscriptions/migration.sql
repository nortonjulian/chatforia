-- CreateTable
CREATE TABLE "GooglePlaySubscription" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "packageName" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "basePlanId" TEXT,
    "purchaseToken" TEXT NOT NULL,
    "linkedPurchaseToken" TEXT,
    "latestOrderId" TEXT,
    "entitlementPlan" "Plan" NOT NULL,
    "subscriptionState" TEXT NOT NULL,
    "acknowledgementState" TEXT,
    "autoRenewEnabled" BOOLEAN,
    "startTime" TIMESTAMP(3),
    "expiryTime" TIMESTAMP(3),
    "regionCode" VARCHAR(2),
    "isTestPurchase" BOOLEAN NOT NULL DEFAULT false,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePlaySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GooglePlaySubscription_purchaseToken_key"
ON "GooglePlaySubscription"("purchaseToken");

-- CreateIndex
CREATE INDEX "GooglePlaySubscription_userId_subscriptionState_idx"
ON "GooglePlaySubscription"("userId", "subscriptionState");

-- CreateIndex
CREATE INDEX "GooglePlaySubscription_productId_basePlanId_idx"
ON "GooglePlaySubscription"("productId", "basePlanId");

-- CreateIndex
CREATE INDEX "GooglePlaySubscription_expiryTime_idx"
ON "GooglePlaySubscription"("expiryTime");

-- CreateIndex
CREATE INDEX "GooglePlaySubscription_latestOrderId_idx"
ON "GooglePlaySubscription"("latestOrderId");

-- AddForeignKey
ALTER TABLE "GooglePlaySubscription"
ADD CONSTRAINT "GooglePlaySubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
