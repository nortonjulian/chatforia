import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockDeleteMany = jest.fn();
const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockRoomFindUnique = jest.fn();
const db = {
  userBlock: {
    findMany: mockFindMany, upsert: mockUpsert,
    deleteMany: mockDeleteMany, findFirst: mockFindFirst,
  },
  user: { findUnique: mockFindUnique },
  chatRoom: { findUnique: mockRoomFindUnique },
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: db }));
let authId = 11;
jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: authId }; next(); },
}));
const { default: blocksRouter } = await import('../routes/blocks.js');
const { assertDirectUsersAllowed, assertDirectRoomAllowed } = await import('../services/userBlockService.js');

function app() {
  const server = express();
  server.use(express.json());
  server.use('/blocks', blocksRouter);
  server.use((err, _req, res, _next) =>
    res.status(err?.output?.statusCode || 500).json({ error: err.message })
  );
  return server;
}
const target = { id: 22, username: 'target', displayName: 'Target', avatarUrl: null };
const record = { id: 5, blockerId: 11, blockedId: 22, blocked: target, createdAt: new Date() };

beforeEach(() => {
  jest.resetAllMocks();
  authId = 11;
  mockFindMany.mockResolvedValue([]);
  mockFindFirst.mockResolvedValue(null);
  mockFindUnique.mockResolvedValue({ ...target, deletedAt: null });
  mockUpsert.mockResolvedValue(record);
  mockDeleteMany.mockResolvedValue({ count: 1 });
  mockRoomFindUnique.mockResolvedValue({ isGroup: false, participants: [{ userId: 11 }, { userId: 22 }] });
});

describe('persistent Chatforia account blocks', () => {
  it('lists only the authenticated user’s outgoing blocks', async () => {
    mockFindMany.mockResolvedValue([record]);
    const res = await request(app()).get('/blocks');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ userId: 22, username: 'target' });
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { blockerId: 11 } }));
  });
  it('rejects blocking yourself and invalid identities', async () => {
    expect((await request(app()).post('/blocks').send({ targetUserId: 11 })).status).toBe(400);
    expect((await request(app()).post('/blocks').send({ targetUserId: 'invalid' })).status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it('does not create a block for a missing or deleted account', async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await request(app()).post('/blocks').send({ targetUserId: 22 });
    expect(res.status).toBe(404);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it('upserts owned block independently of moderation reports', async () => {
    const res = await request(app()).post('/blocks').send({ targetUserId: 22 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { blockerId_blockedId: { blockerId: 11, blockedId: 22 } },
    }));
  });
  it('unblocks only the authenticated user’s directional block', async () => {
    const res = await request(app()).delete('/blocks/22');
    expect(res.status).toBe(200);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { blockerId: 11, blockedId: 22 } });
  });
  it('rejects direct contacts when either direction has blocked', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 5 });
    await expect(assertDirectUsersAllowed(11, 22, db)).rejects.toMatchObject({ output: { statusCode: 403 } });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ blockerId: 11, blockedId: 22 }, { blockerId: 22, blockedId: 11 }] },
      select: { id: true },
    });
  });
  it('rejects sending in an existing blocked 1:1 conversation', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 5 });
    await expect(assertDirectRoomAllowed(123, 11, db)).rejects.toMatchObject({ output: { statusCode: 403 } });
  });
  it('does not blanket-block a group with a blocked participant', async () => {
    mockRoomFindUnique.mockResolvedValueOnce({ isGroup: true, participants: [{ userId: 11 }, { userId: 22 }] });
    await expect(assertDirectRoomAllowed(124, 11, db)).resolves.toBeUndefined();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});
