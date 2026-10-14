-- CreateTable
CREATE TABLE "EsimReplacement" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "oldSubscriberId" INTEGER NOT NULL,
    "newSubscriberId" INTEGER,
    "oldIccid" TEXT NOT NULL,
    "newIccid" TEXT,
    "oldProviderProfileId" TEXT,
    "newProviderProfileId" TEXT,
    "oldProviderPurchaseId" TEXT NOT NULL,
    "newProviderPurchaseId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "remainingDataMb" INTEGER NOT NULL,
    "originalExpiresAt" TIMESTAMP(3),
    "replacementDataMb" INTEGER,
    "replacementAddonKind" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'DEVICE_REPLACEMENT',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provisionedAt" TIMESTAMP(3),
    "oldPackageTerminatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "EsimReplacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EsimReplacement_oldProviderPurchaseId_key" ON "EsimReplacement"("oldProviderPurchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "EsimReplacement_userId_idempotencyKey_key" ON "EsimReplacement"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EsimReplacement_userId_createdAt_idx" ON "EsimReplacement"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EsimReplacement_purchaseId_createdAt_idx" ON "EsimReplacement"("purchaseId", "createdAt");

-- CreateIndex
CREATE INDEX "EsimReplacement_oldSubscriberId_idx" ON "EsimReplacement"("oldSubscriberId");

-- CreateIndex
CREATE INDEX "EsimReplacement_newSubscriberId_idx" ON "EsimReplacement"("newSubscriberId");

-- CreateIndex
CREATE INDEX "EsimReplacement_status_idx" ON "EsimReplacement"("status");

-- AddForeignKey
ALTER TABLE "EsimReplacement" ADD CONSTRAINT "EsimReplacement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsimReplacement" ADD CONSTRAINT "EsimReplacement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "MobileDataPackPurchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsimReplacement" ADD CONSTRAINT "EsimReplacement_oldSubscriberId_fkey" FOREIGN KEY ("oldSubscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsimReplacement" ADD CONSTRAINT "EsimReplacement_newSubscriberId_fkey" FOREIGN KEY ("newSubscriberId") REFERENCES "Subscriber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
