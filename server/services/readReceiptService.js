// MessageRead is private unread/badge state. Message.readBy contains only
// receipts deliberately shared on the first read. Never backfill private reads.
export async function recordMessageReads(prisma, messageIds, userId) {
  const ids = [...new Set(messageIds.map(Number))];
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const reader = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, username: true, showReadReceipts: true },
        });
        if (!reader) throw new Error('Read receipt user not found');
        const existing = await tx.messageRead.findMany({
          where: { userId, messageId: { in: ids } },
          select: { messageId: true },
        });
        const alreadyRead = new Set(existing.map((row) => row.messageId));
        const freshIds = ids.filter((id) => !alreadyRead.has(id));
        const readAt = new Date();
        await tx.messageRead.createMany({
          data: ids.map((messageId) => ({ messageId, userId, readAt })),
          skipDuplicates: true,
        });
        const sharedIds = reader.showReadReceipts === true ? freshIds : [];
        if (sharedIds.length) {
          await tx.user.update({
            where: { id: userId },
            data: { readMessages: { connect: sharedIds.map((id) => ({ id })) } },
            select: { id: true },
          });
        }
        return { sharedIds, readAt, reader: { id: reader.id, username: reader.username } };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      // Concurrent devices may mark the same messages. Retry serialization
      // conflicts so a private first read cannot become a shared second read.
      if (error?.code !== 'P2034' || attempt >= 2) throw error;
    }
  }
}
