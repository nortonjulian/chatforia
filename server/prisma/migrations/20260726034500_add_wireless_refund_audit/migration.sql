ALTER TABLE "MobileDataPackPurchase"
ADD COLUMN "stripeChargeId" TEXT,
ADD COLUMN "refundStatus" TEXT,
ADD COLUMN "refundedAmountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "refundedCurrency" TEXT,
ADD COLUMN "refundedDataMb" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastRefundId" TEXT,
ADD COLUMN "lastRefundEventId" TEXT,
ADD COLUMN "refundedAt" TIMESTAMP(3),
ADD COLUMN "refundReviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "MobileDataPackPurchase_refundReviewRequired_idx"
ON "MobileDataPackPurchase"("refundReviewRequired");

CREATE INDEX "MobileDataPackPurchase_refundStatus_idx"
ON "MobileDataPackPurchase"("refundStatus");
