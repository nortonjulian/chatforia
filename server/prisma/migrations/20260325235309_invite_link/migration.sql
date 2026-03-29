-- CreateTable
CREATE TABLE "PeopleInvite" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "inviterUserId" INTEGER NOT NULL,
    "targetPhone" TEXT,
    "targetEmail" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'share_link',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "acceptedByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PeopleInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PeopleInvite_code_key" ON "PeopleInvite"("code");

-- CreateIndex
CREATE INDEX "PeopleInvite_inviterUserId_idx" ON "PeopleInvite"("inviterUserId");

-- CreateIndex
CREATE INDEX "PeopleInvite_targetPhone_idx" ON "PeopleInvite"("targetPhone");

-- CreateIndex
CREATE INDEX "PeopleInvite_acceptedByUserId_idx" ON "PeopleInvite"("acceptedByUserId");

-- AddForeignKey
ALTER TABLE "PeopleInvite" ADD CONSTRAINT "PeopleInvite_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeopleInvite" ADD CONSTRAINT "PeopleInvite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
