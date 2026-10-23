import express from 'express';
import asyncHandler from 'express-async-handler';
import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);

function positiveUserId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw Boom.badRequest('Valid targetUserId is required');
  return n;
}
const userSelect = { id: true, username: true, displayName: true, avatarUrl: true };
const shape = (record) => ({
  id: record.id,
  userId: record.blockedId,
  username: record.blocked.username,
  displayName: record.blocked.displayName,
  avatarUrl: record.blocked.avatarUrl,
  createdAt: record.createdAt,
});

router.get('/', asyncHandler(async (req, res) => {
  const rows = await prisma.userBlock.findMany({
    where: { blockerId: Number(req.user.id) },
    orderBy: { createdAt: 'desc' },
    include: { blocked: { select: userSelect } },
  });
  res.set('Cache-Control', 'no-store');
  return res.json({ items: rows.map(shape) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const blockerId = Number(req.user.id);
  const blockedId = positiveUserId(req.body?.targetUserId);
  if (blockerId === blockedId) throw Boom.badRequest('Cannot block your own account');

  const target = await prisma.user.findUnique({
    where: { id: blockedId }, select: { ...userSelect, deletedAt: true },
  });
  if (!target || target.deletedAt) throw Boom.notFound('Account not found');

  const record = await prisma.userBlock.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    update: {},
    create: { blockerId, blockedId },
    include: { blocked: { select: userSelect } },
  });
  res.locals.audit = { action: 'USER_BLOCK_ACCOUNT', targetUserId: blockedId };
  return res.status(200).json({ success: true, item: shape(record) });
}));

router.delete('/:targetUserId', asyncHandler(async (req, res) => {
  const blockerId = Number(req.user.id);
  const blockedId = positiveUserId(req.params.targetUserId);
  const { count } = await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
  // Idempotent for multiple devices or retries, without affecting a reverse block.
  res.locals.audit = { action: 'USER_UNBLOCK_ACCOUNT', targetUserId: blockedId };
  return res.json({ success: true, removed: count > 0, userId: blockedId });
}));

export default router;
