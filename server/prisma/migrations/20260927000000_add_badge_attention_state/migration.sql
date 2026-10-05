-- Add durable attention state for app-icon badge synchronization.
ALTER TABLE "Call" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "SmsThread" ADD COLUMN "lastReadAt" TIMESTAMP(3);

-- Existing historical missed calls should not suddenly become badge items.
UPDATE "Call"
SET "acknowledgedAt" = COALESCE("endedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "status" = 'MISSED' AND "acknowledgedAt" IS NULL;

-- Existing SMS history is treated as already seen at migration time.
UPDATE "SmsThread"
SET "lastReadAt" = CURRENT_TIMESTAMP
WHERE "lastReadAt" IS NULL;
