ALTER TABLE "SmsCarrierEvent" ADD COLUMN "providerMessageId" VARCHAR(128);

CREATE UNIQUE INDEX "SmsCarrierEvent_providerMessageId_key"
  ON "SmsCarrierEvent"("providerMessageId");
