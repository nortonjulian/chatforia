ALTER TABLE "SupportTicket"
ADD COLUMN "supportLevel" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN "supportPriority" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "SupportTicket_status_supportPriority_createdAt_idx"
ON "SupportTicket"("status", "supportPriority", "createdAt");
