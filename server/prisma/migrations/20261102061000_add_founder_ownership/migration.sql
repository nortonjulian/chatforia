-- CreateTable
CREATE TABLE "FounderOwnership" (
    "id" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "establishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationRef" TEXT NOT NULL,

    CONSTRAINT "FounderOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FounderOwnership_userId_key" ON "FounderOwnership"("userId");

-- AddForeignKey
ALTER TABLE "FounderOwnership" ADD CONSTRAINT "FounderOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reserve a single, fixed company founder ownership record.
ALTER TABLE "FounderOwnership"
  ADD CONSTRAINT "FounderOwnership_singleton"
  CHECK ("id" = 1);
