-- CreateTable
CREATE TABLE "MobileDataPackPurchase" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "packCode" TEXT NOT NULL,
    "gb" INTEGER NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileDataPackPurchase_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MobileDataPackPurchase" ADD CONSTRAINT "MobileDataPackPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
