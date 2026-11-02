-- CreateTable
CREATE TABLE "StaffAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "profile" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "grantedById" INTEGER NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedById" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAccessEvent" (
    "id" SERIAL NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "subjectUserId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "previousProfile" TEXT,
    "newProfile" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffAssignment_userId_key" ON "StaffAssignment"("userId");

-- CreateIndex
CREATE INDEX "StaffAssignment_profile_active_idx" ON "StaffAssignment"("profile", "active");

-- CreateIndex
CREATE INDEX "StaffAssignment_grantedById_idx" ON "StaffAssignment"("grantedById");

-- CreateIndex
CREATE INDEX "StaffAssignment_revokedById_idx" ON "StaffAssignment"("revokedById");

-- CreateIndex
CREATE INDEX "StaffAccessEvent_subjectUserId_createdAt_idx" ON "StaffAccessEvent"("subjectUserId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffAccessEvent_actorUserId_createdAt_idx" ON "StaffAccessEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffAccessEvent_action_createdAt_idx" ON "StaffAccessEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAssignment" ADD CONSTRAINT "StaffAssignment_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrict staff assignments to recognized profiles.
ALTER TABLE "StaffAssignment"
  ADD CONSTRAINT "StaffAssignment_profile_valid"
  CHECK ("profile" IN (
    'CTO',
    'ENGINEERING_MANAGER',
    'SENIOR_ENGINEER',
    'SUPPORT',
    'ACCESS_ADMIN'
  ));

-- Active assignments cannot carry revocation metadata.
-- Inactive assignments may be pending or fully revoked.
ALTER TABLE "StaffAssignment"
  ADD CONSTRAINT "StaffAssignment_revocation_consistent"
  CHECK (
    (
      "active" = true
      AND "revokedAt" IS NULL
      AND "revokedById" IS NULL
    )
    OR
    (
      "active" = false
      AND (
        ("revokedAt" IS NULL AND "revokedById" IS NULL)
        OR
        ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL)
      )
    )
  );
