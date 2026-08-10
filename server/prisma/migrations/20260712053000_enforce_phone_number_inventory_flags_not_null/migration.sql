-- Align the production PhoneNumber table with the Prisma schema.
-- Existing defaults already match the schema, and all existing rows
-- were verified to contain non-null values.

ALTER TABLE "PhoneNumber"
ALTER COLUMN "isLeasable" SET NOT NULL,
ALTER COLUMN "isPurchasable" SET NOT NULL;
