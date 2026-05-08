-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "locality" TEXT,
ADD COLUMN     "region" TEXT;

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAutomationEvent" (
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

-- CreateTable
CREATE TABLE "SupportAutoAction" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAutoAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_type_idx" ON "StripeWebhookEvent"("type");

-- CreateIndex
CREATE INDEX "SupportAutomationEvent_userId_idx" ON "SupportAutomationEvent"("userId");

-- CreateIndex
CREATE INDEX "SupportAutomationEvent_category_idx" ON "SupportAutomationEvent"("category");

-- CreateIndex
CREATE INDEX "SupportAutomationEvent_createdAt_idx" ON "SupportAutomationEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SupportAutoAction_userId_idx" ON "SupportAutoAction"("userId");

-- CreateIndex
CREATE INDEX "SupportAutoAction_category_idx" ON "SupportAutoAction"("category");
