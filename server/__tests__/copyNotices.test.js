import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { registerCopyNotices } from '../sockets/copyNotices.js';

let handler;
let emitted;
let io;
let prisma;
let clock;

beforeEach(() => {
  handler = undefined;
  emitted = jest.fn();
  io = { to: jest.fn(() => ({ emit: emitted })) };
  prisma = {
    message: { findUnique: jest.fn().mockResolvedValue({
      id: 33, chatRoomId: 9, senderId: 2, deletedForAll: false,
      deletedBySender: false, expiresAt: null, isHiddenByModeration: false,
    }) },
    participant: { findFirst: jest.fn().mockResolvedValue({ id: 1 }) },
    user: { findUnique: jest.fn().mockResolvedValue({ notifyOnCopy: true }) },
  };
  clock = 1761432000000;
  registerCopyNotices(io, { user: { id: 7 }, on: (event, cb) => {
    if (event === 'message:copied') handler = cb;
  } }, { prisma, now: () => clock });
});

test('sends only minimal metadata to the true sender when opted in', async () => {
  await handler({ messageId: 33, senderId: 999, chatRoomId: 999, content: 'private' });
  expect(prisma.message.findUnique).toHaveBeenCalledWith({
    where: { id: 33 },
    select: expect.objectContaining({ chatRoomId: true, senderId: true }),
  });
  expect(prisma.participant.findFirst).toHaveBeenCalledWith({
    where: { chatRoomId: 9, userId: 7 }, select: { id: true },
  });
  expect(io.to).toHaveBeenCalledWith('user:2');
  expect(emitted).toHaveBeenCalledWith('message:copy-notice', {
    messageId: 33, chatRoomId: 9, copiedByUserId: 7,
    at: new Date(clock).toISOString(),
  });
  expect(JSON.stringify(emitted.mock.calls)).not.toContain('private');
});

test('ignores malformed or nonpositive IDs', async () => {
  await handler({ messageId: '33' });
  await handler({ messageId: -1 });
  await handler(null);
  await handler({ messageId: 3.5 });
  expect(prisma.message.findUnique).not.toHaveBeenCalled();
  expect(io.to).not.toHaveBeenCalled();
});

test('cannot report copies of messages in rooms the actor cannot access', async () => {
  prisma.participant.findFirst.mockResolvedValue(null);
  await handler({ messageId: 33 });
  expect(io.to).not.toHaveBeenCalled();
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});

test('does not notify when sender opted out', async () => {
  prisma.user.findUnique.mockResolvedValue({ notifyOnCopy: false });
  await handler({ messageId: 33 });
  expect(io.to).not.toHaveBeenCalled();
});

test('ignores own messages and deleted or expired messages', async () => {
  for (const patch of [
    { senderId: 7 }, { deletedForAll: true }, { deletedBySender: true },
    { expiresAt: new Date(clock - 1000) }, { isHiddenByModeration: true },
  ]) {
    prisma.message.findUnique.mockResolvedValueOnce({
      id: 33, senderId: 2, chatRoomId: 9, ...patch,
    });
    await handler({ messageId: 33 });
    clock += 31_000;
  }
  expect(io.to).not.toHaveBeenCalled();
});

test('throttles repeated copy notices on the same connection', async () => {
  await handler({ messageId: 33 });
  await handler({ messageId: 33 });
  expect(emitted).toHaveBeenCalledTimes(1);
  clock += 31_000;
  await handler({ messageId: 33 });
  expect(emitted).toHaveBeenCalledTimes(2);
});

test('fails closed on database errors', async () => {
  prisma.message.findUnique.mockRejectedValue(new Error('database failed'));
  await expect(handler({ messageId: 33 })).resolves.toBeUndefined();
  expect(io.to).not.toHaveBeenCalled();
});
