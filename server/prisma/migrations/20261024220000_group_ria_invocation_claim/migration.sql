-- Permanent unique source-message claim prevents duplicate billable AI invocations.
-- Intentionally does not store plaintext prompts.
CREATE TABLE "GroupRiaInvocation" (
  "sourceMessageId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CLAIMED',
  "replyMessageId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GroupRiaInvocation_pkey" PRIMARY KEY ("sourceMessageId")
);
ALTER TABLE "GroupRiaInvocation" ADD CONSTRAINT "GroupRiaInvocation_sourceMessageId_fkey"
  FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "GroupRiaInvocation_replyMessageId_key" ON "GroupRiaInvocation"("replyMessageId");
ALTER TABLE "GroupRiaInvocation" ADD CONSTRAINT "GroupRiaInvocation_replyMessageId_fkey"
  FOREIGN KEY ("replyMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
