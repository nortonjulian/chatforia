-- Records issued presigned upload authorizations.
-- Completion must validate the stored object against these records.

CREATE TABLE "PendingUpload" (
    "id" TEXT NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedUploadId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "PendingUpload_ownerId_fkey"
      FOREIGN KEY ("ownerId")
      REFERENCES "User"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PendingUpload_key_key"
    ON "PendingUpload"("key");

CREATE INDEX "PendingUpload_ownerId_expiresAt_idx"
    ON "PendingUpload"("ownerId", "expiresAt");

CREATE INDEX "PendingUpload_expiresAt_idx"
    ON "PendingUpload"("expiresAt");

ALTER TABLE "PendingUpload"
    ADD CONSTRAINT "PendingUpload_expectedSize_positive"
    CHECK ("expectedSize" > 0);

CREATE UNIQUE INDEX "PendingUpload_completedUploadId_key"
    ON "PendingUpload"("completedUploadId");

ALTER TABLE "PendingUpload"
    ADD CONSTRAINT "PendingUpload_completedUploadId_fkey"
    FOREIGN KEY ("completedUploadId")
    REFERENCES "Upload"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
