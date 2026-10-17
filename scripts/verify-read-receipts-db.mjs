// Optional real PostgreSQL integration check. Uses only a dedicated local
// chatforia_receipts_test database with the current schema already installed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordMessageReads } from '../server/services/readReceiptService.js';

const rawURL = process.env.TEST_DATABASE_URL;
if (!rawURL) throw new Error('Set TEST_DATABASE_URL to the isolated local receipt test database.');
const target = new URL(rawURL);
if (!['postgresql:', 'postgres:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.pathname !== '/chatforia_receipts_test') {
  throw new Error('Refusing database access: requires local database named chatforia_receipts_test.');
}
const { PrismaClient } = await import('@prisma/client');
const makeClient = () => new PrismaClient({ datasources: { db: { url: rawURL } } });
const prisma = makeClient();
const users = [];
let room;
try {
  const unique = randomUUID().replaceAll('-', '');
  for (const suffix of ['sender', 'reader']) {
    users.push(await prisma.user.create({ data: {
      username: `receipt_${suffix}_${unique}`, passwordHash: 'test-fixture-not-a-login',
      showReadReceipts: true,
    } }));
  }
  const [sender, reader] = users;
  room = await prisma.chatRoom.create({ data: { participants: {
    create: users.map((user) => ({ userId: user.id })),
  } } });
  const messages = [];
  for (let index = 0; index < 3; index++) {
    messages.push(await prisma.message.create({ data: {
      senderId: sender.id, chatRoomId: room.id, rawContent: `receipt fixture ${index}`,
      translations: { es: 'texto de prueba' }, revision: 2,
    } }));
  }
  const [first, privateMessage, last] = messages;
  const results = await Promise.all([
    recordMessageReads(prisma, [first.id], reader.id),
    recordMessageReads(prisma, [first.id], reader.id),
  ]);
  assert.deepEqual(results.flatMap((result) => result.sharedIds), [first.id]);
  assert.equal(await prisma.messageRead.count({ where: { messageId: first.id, userId: reader.id } }), 1);
  const privateKey = { messageId_userId: { messageId: privateMessage.id, userId: reader.id } };
  await prisma.user.update({ where: { id: reader.id }, data: { showReadReceipts: false } });
  assert.deepEqual((await recordMessageReads(prisma, [privateMessage.id], reader.id)).sharedIds, []);
  const privateRead = await prisma.messageRead.findUnique({ where: privateKey });
  assert.ok(privateRead);
  await prisma.user.update({ where: { id: reader.id }, data: { showReadReceipts: true } });
  assert.deepEqual((await recordMessageReads(prisma, [privateMessage.id, last.id], reader.id)).sharedIds, [last.id]);
  assert.equal((await prisma.messageRead.findUnique({ where: privateKey })).readAt.getTime(), privateRead.readAt.getTime());
  const cold = makeClient();
  try {
    const stored = await cold.message.findMany({
      where: { chatRoomId: room.id }, orderBy: { id: 'asc' },
      include: { readBy: { select: { id: true } } },
    });
    assert.deepEqual(stored.map((message) => message.readBy.map((user) => user.id)), [[reader.id], [], [reader.id]]);
    assert.deepEqual(stored.map(({ readBy, ...message }) => message), messages);
    assert.equal(await cold.message.count({ where: {
      chatRoomId: room.id, senderId: { not: reader.id }, reads: { none: { userId: reader.id } },
    } }), 0);
  } finally { await cold.$disconnect(); }
  console.log('PASS: real database relations, concurrent first reads, private reads, reenable, cold client, unchanged message data and unread count');
} finally {
  // Delete only this run's fixtures. Never reset the database or delete by prefix.
  try {
    if (room) await prisma.chatRoom.delete({ where: { id: room.id } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  } finally { await prisma.$disconnect(); }
}
