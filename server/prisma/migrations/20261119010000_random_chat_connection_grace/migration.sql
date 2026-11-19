CREATE TABLE "RandomChatConnection" (
    "randomChatRoomId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "socketId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "friendRequestedAt" TIMESTAMP(3),
    CONSTRAINT "RandomChatConnection_pkey" PRIMARY KEY ("randomChatRoomId", "userId")
);

CREATE INDEX "RandomChatConnection_socketId_idx" ON "RandomChatConnection"("socketId");
CREATE INDEX "RandomChatConnection_active_disconnectedAt_idx" ON "RandomChatConnection"("active", "disconnectedAt");
CREATE UNIQUE INDEX "RandomChatConnection_one_active_match_per_user"
    ON "RandomChatConnection"("userId") WHERE "active" = true;

ALTER TABLE "RandomChatConnection" ADD CONSTRAINT "RandomChatConnection_randomChatRoomId_fkey"
    FOREIGN KEY ("randomChatRoomId") REFERENCES "RandomChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RandomChatConnection" ADD CONSTRAINT "RandomChatConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The restricted API role needs reads, new bindings, and lifecycle updates.
-- Session ownership keys are immutable; explicit deletion is not required.
GRANT SELECT, INSERT ON TABLE public."RandomChatConnection" TO chatforia_dev;
GRANT UPDATE ("socketId", "active", "lastSeenAt", "disconnectedAt", "friendRequestedAt")
    ON TABLE public."RandomChatConnection" TO chatforia_dev;
