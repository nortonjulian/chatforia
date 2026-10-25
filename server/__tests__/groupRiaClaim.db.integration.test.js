/**
 * Real PostgreSQL coverage for the durable Group Ria invocation claim.
 * Uses an explicitly selected localhost *_test database and ALWAYS rolls back.
 * No OpenAI calls, sockets, pushes, or production data access.
 */
import { jest, test, expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseSelected } from './helpers/testDatabase.js';

jest.setTimeout(60000);
const { raw } = assertTestDatabaseSelected();
const target = new URL(raw);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Group Ria DB verification requires localhost test PostgreSQL');
}
const client = new PrismaClient({ datasources: { db: { url: raw } } });
const rollback = new Error('Intentional group Ria DB test rollback');

test('source-message claims are durable, uniquely constrained and link to one reply', async () => {
  try {
    await client.$transaction(async (tx) => {
      const suffix = randomUUID().replaceAll('-', '');
      const user = await tx.user.create({
        data: { username: `group_ria_claim_${suffix}`, passwordHash: 'test-only-not-login' },
      });
      const room = await tx.chatRoom.create({
        data: {
          isGroup: true,
          participants: { create: [{ userId: user.id }] },
        },
      });
      const source = await tx.message.create({
        data: { senderId: user.id, chatRoomId: room.id, rawContent: '@Ria hello' },
      });
      const reply = await tx.message.create({
        data: { senderId: user.id, chatRoomId: room.id, rawContent: 'Hello', isAutoReply: true },
      });
      const claimed = await tx.groupRiaInvocation.create({
        data: { sourceMessageId: source.id },
      });
      expect(claimed.status).toBe('CLAIMED');
      expect(claimed.replyMessageId).toBeNull();

      const delivered = await tx.groupRiaInvocation.update({
        where: { sourceMessageId: source.id },
        data: { status: 'DELIVERED', replyMessageId: reply.id },
      });
      expect(delivered.replyMessageId).toBe(reply.id);
      expect(delivered.status).toBe('DELIVERED');

      // A concurrent worker or a retried request must not claim this source again.
      await expect(
        tx.groupRiaInvocation.create({ data: { sourceMessageId: source.id } }),
      ).rejects.toMatchObject({ code: 'P2002' });

      throw rollback;
    }, { timeout: 45000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await client.$disconnect();
  }
});
