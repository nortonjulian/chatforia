-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "apnsSandboxPushToken" TEXT,
ADD COLUMN     "voipSandboxPushToken" TEXT;

-- CreateIndex
CREATE INDEX "Device_apnsSandboxPushToken_idx" ON "Device"("apnsSandboxPushToken");

-- CreateIndex
CREATE INDEX "Device_voipSandboxPushToken_idx" ON "Device"("voipSandboxPushToken");
