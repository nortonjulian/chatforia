import express from "express";
export const readsRouter = express.Router();

readsRouter.get("/rooms/:roomId/reads", async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user.id; // however your auth middleware sets it
    const sinceMessageId = Number(req.query.sinceMessageId || 0);

    // membership check
    const isMember = await req.prisma.chatRoomUser.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { userId: true },
    });
    if (!isMember) return res.status(403).json({ error: "FORBIDDEN" });

    const reads = await req.prisma.messageRead.findMany({
      where: {
        message: {
          roomId,
          id: { gt: sinceMessageId },
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

    res.json({
      roomId,
      sinceMessageId,
      reads: reads.map(r => ({
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