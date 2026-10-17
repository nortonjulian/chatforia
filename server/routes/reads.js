import express from "express";
export const readsRouter = express.Router();

readsRouter.get("/rooms/:roomId/reads", async (req, res) => {
  try {
    const roomId = Number(req.params.roomId);
    const userId = Number(req.user?.id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }
    const sinceMessageId = Number(req.query.sinceMessageId || 0);
    if (!Number.isSafeInteger(roomId) || roomId <= 0 ||
        !Number.isSafeInteger(sinceMessageId) || sinceMessageId < 0) {
      return res.status(400).json({ error: "BAD_PAYLOAD" });
    }

    // membership check
    const isMember = await req.prisma.participant.findUnique({
      where: { chatRoomId_userId: { chatRoomId: roomId, userId } },
      select: { userId: true },
    });
    if (!isMember) return res.status(403).json({ error: "FORBIDDEN" });

    const reads = await req.prisma.messageRead.findMany({
      where: {
        message: {
          chatRoomId: roomId,
          id: { gt: sinceMessageId },
          deletedForAll: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      },
      select: {
        messageId: true,
        userId: true,
        readAt: true,
      },
      orderBy: [{ messageId: "asc" }, { readAt: "asc" }],
      take: 5000, // safety cap
    });

    const sharedMessages = await req.prisma.message.findMany({
      where: { id: { in: [...new Set(reads.map((read) => read.messageId))] } },
      select: {
        id: true,
        readBy: { select: { id: true } },
      },
    });
    const sharedPairs = new Set(sharedMessages.flatMap((message) =>
      message.readBy.map((reader) => `${message.id}:${reader.id}`)
    ));

    res.json({
      roomId: req.params.roomId,
      sinceMessageId,
      reads: reads.filter(r => sharedPairs.has(`${r.messageId}:${r.userId}`)).map(r => ({
        messageId: r.messageId,
        userId: r.userId,
        readAt: r.readAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});