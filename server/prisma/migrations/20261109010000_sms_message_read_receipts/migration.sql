-- Preserve the old thread-level read boundary for existing messages, then
-- track each committed incoming SMS separately so later arrivals (including
-- those with an identical createdAt) cannot be acknowledged retroactively.
ALTER TABLE "SmsMessage" ADD COLUMN "readAt" TIMESTAMP(3);

UPDATE "SmsMessage" AS message
SET "readAt" = thread."lastReadAt"
FROM "SmsThread" AS thread
WHERE message."threadId" = thread.id
  AND message.direction = 'in'
  AND thread."lastReadAt" IS NOT NULL
  AND message."createdAt" <= thread."lastReadAt";

CREATE INDEX "SmsMessage_threadId_direction_readAt_idx"
  ON "SmsMessage"("threadId", direction, "readAt");
