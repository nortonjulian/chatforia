-- Persistent, directional Chatforia account blocks, independent of SMS blocks.
CREATE TABLE "UserBlock" (
  "id" SERIAL NOT NULL,
  "blockerId" INTEGER NOT NULL,
  "blockedId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserBlock_no_self_block" CHECK ("blockerId" <> "blockedId")
);
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");
CREATE INDEX "UserBlock_blockedId_blockerId_idx" ON "UserBlock"("blockedId", "blockerId");
CREATE INDEX "UserBlock_blockerId_createdAt_idx" ON "UserBlock"("blockerId", "createdAt");
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey"
  FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey"
  FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve earlier user-requested report+block actions. Reports stay intact
-- even if users subsequently unblock the reported account.
INSERT INTO "UserBlock" ("blockerId", "blockedId", "createdAt")
SELECT DISTINCT ON ("reporterId", "reportedUserId")
  "reporterId", "reportedUserId", "createdAt"
FROM "Report"
WHERE "blockApplied" = TRUE
  AND "reportType" = 'APP'
  AND "reportedUserId" IS NOT NULL
  AND "reporterId" <> "reportedUserId"
ORDER BY "reporterId", "reportedUserId", "createdAt" ASC
ON CONFLICT ("blockerId", "blockedId") DO NOTHING;
