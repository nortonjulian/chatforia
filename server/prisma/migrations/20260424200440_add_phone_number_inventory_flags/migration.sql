-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "isLeasable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isPurchasable" BOOLEAN NOT NULL DEFAULT false;
