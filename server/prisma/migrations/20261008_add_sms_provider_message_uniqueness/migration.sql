-- Prevent concurrent/retried provider webhooks from persisting the same
-- carrier message more than once. PostgreSQL allows multiple NULL values in
-- a unique index, so legacy/local rows without provider identifiers remain valid.
CREATE UNIQUE INDEX "SmsMessage_provider_providerMessageId_key"
ON "SmsMessage"("provider", "providerMessageId");
