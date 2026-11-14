CREATE TABLE "EsimOperationLock" (
  "userId" INTEGER NOT NULL,
  "token" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "operationKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EsimOperationLock_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "EsimOperationLock_token_key" ON "EsimOperationLock"("token");

GRANT SELECT, INSERT, DELETE ON TABLE public."EsimOperationLock" TO chatforia_dev;
