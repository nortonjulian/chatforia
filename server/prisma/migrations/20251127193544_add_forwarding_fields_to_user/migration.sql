-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Plan" ADD VALUE 'PLUS';
ALTER TYPE "Plan" ADD VALUE 'WIRELESS';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "forwardEmail" VARCHAR(255),
ADD COLUMN     "forwardPhoneNumber" VARCHAR(32),
ADD COLUMN     "forwardQuietHoursEnd" INTEGER,
ADD COLUMN     "forwardQuietHoursStart" INTEGER,
ADD COLUMN     "forwardSmsToEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forwardSmsToPhone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forwardToPhoneE164" VARCHAR(32),
ADD COLUMN     "forwardingEnabledCalls" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "forwardingEnabledSms" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PriceOverride" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "currency" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceOverride_pkey" PRIMARY KEY ("id")
);
