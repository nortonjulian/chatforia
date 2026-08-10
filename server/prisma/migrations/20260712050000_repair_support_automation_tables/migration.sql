-- Repair tables skipped when
-- 20260508220249_add_stripe_webhook_events failed before
-- reaching its CREATE TABLE statements and was subsequently
-- recorded as applied.

CREATE TABLE IF NOT EXISTS "SupportAutomationEvent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "ticketId" INTEGER,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'support',
    "status" TEXT NOT NULL DEFAULT 'detected',
    "actionTaken" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAutomationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportAutoAction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAutoAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportAutomationEvent_userId_idx"
ON "SupportAutomationEvent"("userId");

CREATE INDEX IF NOT EXISTS "SupportAutomationEvent_category_idx"
ON "SupportAutomationEvent"("category");

CREATE INDEX IF NOT EXISTS "SupportAutomationEvent_createdAt_idx"
ON "SupportAutomationEvent"("createdAt");

CREATE INDEX IF NOT EXISTS "SupportAutoAction_userId_idx"
ON "SupportAutoAction"("userId");

CREATE INDEX IF NOT EXISTS "SupportAutoAction_category_idx"
ON "SupportAutoAction"("category");
