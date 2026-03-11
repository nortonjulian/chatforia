-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'PORTING');

-- AlterTable
ALTER TABLE "MessageAttachment" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "phoneId" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Phone" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "userId" INTEGER,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optedOutAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Phone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneVerificationRequest" (
    "id" SERIAL NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "verificationCode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "intent" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "phoneVerificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phoneId" INTEGER,

    CONSTRAINT "PhoneVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsCarrierEvent" (
    "id" SERIAL NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "action" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsCarrierEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscriber" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "provider" TEXT NOT NULL,
    "providerProfileId" TEXT,
    "iccid" TEXT,
    "iccidHint" TEXT,
    "smdp" TEXT,
    "activationCode" TEXT,
    "lpaUri" TEXT,
    "qrPayload" TEXT,
    "msisdn" TEXT,
    "region" VARCHAR(8),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsConsent" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "pendingRegistration" JSONB,
    "consentTextVersion" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsOptOut" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "provider" TEXT,
    "reason" TEXT,
    "inboundMessageId" TEXT,
    "rawPayload" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneOtp" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "otpCode" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Phone_number_key" ON "Phone"("number");

-- CreateIndex
CREATE INDEX "Phone_userId_idx" ON "Phone"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneVerificationRequest_phoneVerificationId_key" ON "PhoneVerificationRequest"("phoneVerificationId");

-- CreateIndex
CREATE INDEX "PhoneVerificationRequest_phoneId_idx" ON "PhoneVerificationRequest"("phoneId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_iccid_key" ON "Subscriber"("iccid");

-- CreateIndex
CREATE INDEX "Subscriber_userId_idx" ON "Subscriber"("userId");

-- CreateIndex
CREATE INDEX "Subscriber_provider_providerProfileId_idx" ON "Subscriber"("provider", "providerProfileId");

-- CreateIndex
CREATE INDEX "Subscriber_msisdn_idx" ON "Subscriber"("msisdn");

-- CreateIndex
CREATE INDEX "SmsConsent_phone_idx" ON "SmsConsent"("phone");

-- CreateIndex
CREATE INDEX "SmsOptOut_phone_idx" ON "SmsOptOut"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "SmsOptOut_phone_provider_key" ON "SmsOptOut"("phone", "provider");

-- CreateIndex
CREATE INDEX "PhoneOtp_phone_idx" ON "PhoneOtp"("phone");

-- CreateIndex
CREATE INDEX "msg_room_time_id" ON "Message"("chatRoomId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "msg_deleted_expires_idx" ON "Message"("deletedForAll", "expiresAt");

-- CreateIndex
CREATE INDEX "MessageAttachment_deletedAt_idx" ON "MessageAttachment"("deletedAt");

-- CreateIndex
CREATE INDEX "SmsMessage_phoneId_createdAt_idx" ON "SmsMessage"("phoneId", "createdAt");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES "Phone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phone" ADD CONSTRAINT "Phone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneVerificationRequest" ADD CONSTRAINT "PhoneVerificationRequest_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES "Phone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
