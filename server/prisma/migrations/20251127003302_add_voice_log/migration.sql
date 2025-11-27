-- CreateEnum
CREATE TYPE "PhoneNumberSource" AS ENUM ('PROVISIONED', 'PORTED');

-- AlterEnum
ALTER TYPE "NumberStatus" ADD VALUE 'RELEASED';

-- AlterTable
ALTER TABLE "PhoneNumber" ADD COLUMN     "source" "PhoneNumberSource" NOT NULL DEFAULT 'PROVISIONED',
ADD COLUMN     "twilioSid" TEXT,
ALTER COLUMN "provider" SET DEFAULT 'twilio';

-- CreateTable
CREATE TABLE "VoiceLog" (
    "id" SERIAL NOT NULL,
    "callSid" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT,
    "direction" TEXT,
    "status" TEXT,
    "answeredBy" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortRequest" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "externalPortId" TEXT,
    "carrier" TEXT,
    "accountNumber" TEXT,
    "pin" TEXT,
    "fullName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "status" "PortStatus" NOT NULL DEFAULT 'NONE',
    "statusReason" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceLog_callSid_key" ON "VoiceLog"("callSid");

-- AddForeignKey
ALTER TABLE "PortRequest" ADD CONSTRAINT "PortRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
