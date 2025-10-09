-- CreateEnum
CREATE TYPE "public"."A11YFont" AS ENUM ('sm', 'md', 'lg', 'xl');

-- CreateEnum
CREATE TYPE "public"."A11YBg" AS ENUM ('light', 'dark', 'transparent');

-- AlterTable
ALTER TABLE "public"."User" ALTER COLUMN "allowExplicitContent" SET DEFAULT false;
