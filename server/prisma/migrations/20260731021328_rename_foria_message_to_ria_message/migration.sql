ALTER TABLE "ForiaMessage"
RENAME TO "RiaMessage";

ALTER INDEX "ForiaMessage_pkey"
RENAME TO "RiaMessage_pkey";

ALTER INDEX "ForiaMessage_userId_createdAt_idx"
RENAME TO "RiaMessage_userId_createdAt_idx";

ALTER TABLE "RiaMessage"
RENAME CONSTRAINT "ForiaMessage_userId_fkey"
TO "RiaMessage_userId_fkey";
