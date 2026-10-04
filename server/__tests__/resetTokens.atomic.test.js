/** @jest-environment node */
import { jest } from '@jest/globals';
import { fileURLToPath } from 'node:url';

const prismaPath = fileURLToPath(new URL('../utils/prismaClient.js', import.meta.url));
const tx = {
  $queryRaw: jest.fn(),
  passwordResetToken: {
    findFirst: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn(), create: jest.fn(),
  },
};
const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
await jest.unstable_mockModule(prismaPath, () => ({ default: prisma }));
const { consumeResetToken, issueResetToken, purgeResetTokens } = await import('../utils/resetTokens.js');
const token = 'a'.repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([{ id: 7 }]);
  tx.passwordResetToken.findFirst.mockResolvedValue({ id: 11, userId: 7 });
  tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
});

test('missing or malformed tokens never access the database', async () => {
  for (const input of [null, {}, '', 'invalid']) {
    expect(await consumeResetToken(input, tx)).toBeNull();
  }
  expect(tx.passwordResetToken.findFirst).not.toHaveBeenCalled();
});

test('an expired or absent token cannot be claimed', async () => {
  tx.passwordResetToken.findFirst.mockResolvedValue(null);
  expect(await consumeResetToken(token, tx)).toBeNull();
  expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
});

test('an unavailable account cannot claim a previously issued token', async () => {
  tx.$queryRaw.mockResolvedValue([]);
  expect(await consumeResetToken(token, tx)).toBeNull();
  expect(tx.passwordResetToken.updateMany).not.toHaveBeenCalled();
});

test('a token consumed while waiting for the account lock is rejected', async () => {
  tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
  expect(await consumeResetToken(token, tx)).toBeNull();
});

test('successful claims use the caller transaction without opening another', async () => {
  expect(await consumeResetToken(token, tx)).toBe(7);
  expect(prisma.$transaction).not.toHaveBeenCalled();
  expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith({
    where: { id: 11, tokenHash: expect.any(String), usedAt: null, expiresAt: { gt: expect.any(Date) } },
    data: { usedAt: expect.any(Date) },
  });
});

test('standalone consumption opens a transaction', async () => {
  expect(await consumeResetToken(token)).toBe(7);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});

test('issuance failure propagates without creating a token for unavailable accounts', async () => {
  tx.$queryRaw.mockResolvedValue([]);
  await expect(issueResetToken(7)).rejects.toThrow('account unavailable');
  expect(tx.passwordResetToken.create).not.toHaveBeenCalled();
  expect(tx.passwordResetToken.deleteMany).not.toHaveBeenCalled();
});

test('unscoped full purges are refused', async () => {
  await expect(purgeResetTokens({ expiredOnly: false })).rejects.toThrow('userId is required');
});
