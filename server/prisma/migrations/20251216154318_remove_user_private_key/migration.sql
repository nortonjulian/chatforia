/*
  Warnings:

  - The `contentCiphertext` column on the `Message` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `privateKey` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "rawContent" DROP NOT NULL,
DROP COLUMN "contentCiphertext",
ADD COLUMN     "contentCiphertext" JSONB;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "privateKey";
