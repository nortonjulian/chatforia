-- CreateEnum
CREATE TYPE "RegionTier" AS ENUM ('T1', 'T2', 'T3', 'T4', 'ROW');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "billingCountry" VARCHAR(2),
ADD COLUMN     "currency" VARCHAR(8),
ADD COLUMN     "firstPaidAt" TIMESTAMP(3),
ADD COLUMN     "pricingRegion" "RegionTier";

-- CreateTable
CREATE TABLE "RegionRule" (
    "id" TEXT NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL,
    "tier" "RegionTier" NOT NULL,

    CONSTRAINT "RegionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Price" (
    "id" TEXT NOT NULL,
    "product" VARCHAR(64) NOT NULL,
    "tier" "RegionTier" NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "stripePriceId" TEXT,
    "appleSku" TEXT,
    "googleSku" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegionRule_countryCode_key" ON "RegionRule"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Price_stripePriceId_key" ON "Price"("stripePriceId");

-- CreateIndex
CREATE INDEX "Price_product_tier_currency_idx" ON "Price"("product", "tier", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Price_product_tier_currency_key" ON "Price"("product", "tier", "currency");
