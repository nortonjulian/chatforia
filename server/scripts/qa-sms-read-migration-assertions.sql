-- Run after the exact migration SQL, in the same disposable local database.
DO $$
BEGIN
  IF (SELECT count(*) FROM "SmsMessage" WHERE "readAt" IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'legacy read-boundary backfill count differs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SmsMessage"
    WHERE id IN (500,501) AND "readAt" <> '2026-11-09 12:00:00.000'
  ) THEN
    RAISE EXCEPTION 'legacy read timestamp differs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SmsMessage"
    WHERE id IN (502,503,600) AND "readAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'newer, outgoing, or unacknowledged message was backfilled';
  END IF;
END $$;

-- Two later arrivals share the acknowledged timestamp, including one with a
-- lower ID reserved earlier. Neither was in the visible batch.
INSERT INTO "SmsMessage"(id,"threadId",direction,"createdAt") VALUES
  (499,67,'in','2026-11-09 12:00:00.000'),
  (504,67,'in','2026-11-09 12:00:00.000');

UPDATE "SmsMessage"
SET "readAt" = '2026-11-09 12:00:02.000'
WHERE id IN (502) AND "threadId"=67 AND direction='in' AND "readAt" IS NULL;

-- Duplicate and out-of-order requests target only exact visible IDs.
UPDATE "SmsMessage"
SET "readAt" = '2026-11-09 12:00:03.000'
WHERE id IN (501,500,502) AND "threadId"=67 AND direction='in' AND "readAt" IS NULL;

DO $$
BEGIN
  IF (SELECT count(*) FROM "SmsMessage" WHERE "readAt" IS NULL AND direction='in') <> 3 THEN
    RAISE EXCEPTION 'later arrivals were incorrectly acknowledged';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SmsMessage"
    WHERE id IN (499,504,600) AND "readAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'unseen message read state changed';
  END IF;
  IF (SELECT "readAt" FROM "SmsMessage" WHERE id=502) <> '2026-11-09 12:00:02.000' THEN
    RAISE EXCEPTION 'duplicate acknowledgement changed original receipt';
  END IF;
END $$;
