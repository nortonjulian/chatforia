ALTER TABLE "GooglePlaySubscription"
ADD COLUMN "reconciliationLeaseId" TEXT,
ADD COLUMN "reconciliationLeaseUntil" TIMESTAMP(3);

CREATE INDEX "GooglePlaySubscription_reconciliationLeaseUntil_idx"
ON "GooglePlaySubscription"("reconciliationLeaseUntil");
