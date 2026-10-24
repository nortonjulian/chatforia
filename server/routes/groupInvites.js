import express from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';

const router = express.Router();
const validId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const fail = (res, status, error) => res.status(status).json({ error });
const inviteStatus = (invite, now = new Date()) => {
  if (invite.expiresAt && new Date(invite.expiresAt) <= now) return 'expired';
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) return 'exhausted';
  return 'ok';
};

async function requireGroupManager(roomId, userId, res) {
  const room = await prisma.chatRoom.findUnique({
    where: { id: roomId },
    select: {
      isGroup: true,
      ownerId: true,
      participants: { where: { userId }, select: { role: true } },
    },
  });
  if (!room) { fail(res, 404, 'Group not found'); return false; }
  if (!room.isGroup) { fail(res, 400, 'Invitations are only for group chats'); return false; }
  const role = room.participants?.[0]?.role;
  if (!role || (room.ownerId !== userId && role !== 'ADMIN')) {
    fail(res, 403, 'Only group owners or admins may manage invitations');
    return false;
  }
  return true;
}

router.post('/chatrooms/:roomId/invites', requireAuth, async (req, res) => {
  try {
    const roomId = validId(req.params.roomId);
    const userId = validId(req.user?.id);
    if (!roomId || !userId) return fail(res, 400, 'Invalid group or account');
    if (!(await requireGroupManager(roomId, userId, res))) return;

    const rawMax = req.body?.maxUses ?? 0;
    const rawExpiry = req.body?.expiresInMinutes ?? 1440;
    const maxUses = Number(rawMax);
    const expiresInMinutes = Number(rawExpiry);
    if (!Number.isSafeInteger(maxUses) || maxUses < 0 || maxUses > 10000 ||
        !Number.isSafeInteger(expiresInMinutes) || expiresInMinutes < 0 || expiresInMinutes > 10080) {
      return fail(res, 400, 'Invalid invite limits');
    }

    const invite = await prisma.chatRoomInvite.create({
      data: {
        code: crypto.randomBytes(16).toString('base64url'),
        chatRoomId: roomId,
        createdById: userId,
        maxUses,
        expiresAt: expiresInMinutes === 0 ? null : new Date(Date.now() + expiresInMinutes * 60000),
      },
      select: { code: true, expiresAt: true, maxUses: true, uses: true },
    });
    const root = String(process.env.APP_BASE_URL || process.env.WEB_URL ||
      process.env.FRONTEND_ORIGIN || 'https://www.chatforia.com').replace(/\/+$/, '');
    const url = `${root}/join/${invite.code}`;
    return res.json({ ...invite, url });
  } catch (error) {
    console.error('Create group invite failed:', error);
    return fail(res, 500, 'Could not create invite');
  }
});

router.get('/chatrooms/:roomId/invites', requireAuth, async (req, res) => {
  try {
    const roomId = validId(req.params.roomId);
    const userId = validId(req.user?.id);
    if (!roomId || !userId) return fail(res, 400, 'Invalid group or account');
    if (!(await requireGroupManager(roomId, userId, res))) return;
    const items = await prisma.chatRoomInvite.findMany({
      where: { chatRoomId: roomId },
      select: { code: true, expiresAt: true, maxUses: true, uses: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(items);
  } catch (error) {
    console.error('List group invites failed:', error);
    return fail(res, 500, 'Could not list invites');
  }
});

// Revocation deletes the invite token. No migration or nonexistent revokedAt column required.
router.delete('/chatrooms/:roomId/invites/:code', requireAuth, async (req, res) => {
  try {
    const roomId = validId(req.params.roomId);
    const userId = validId(req.user?.id);
    if (!roomId || !userId) return fail(res, 400, 'Invalid group or account');
    if (!(await requireGroupManager(roomId, userId, res))) return;
    const deleted = await prisma.chatRoomInvite.deleteMany({
      where: { code: req.params.code, chatRoomId: roomId },
    });
    if (deleted.count !== 1) return fail(res, 404, 'Invite not found');
    return res.json({ ok: true });
  } catch (error) {
    console.error('Revoke group invite failed:', error);
    return fail(res, 500, 'Could not revoke invite');
  }
});

router.get('/invites/:code', async (req, res) => {
  try {
    const invite = await prisma.chatRoomInvite.findUnique({
      where: { code: req.params.code },
      select: {
        code: true, expiresAt: true, maxUses: true, uses: true,
        chatRoom: { select: { id: true, name: true, isGroup: true } },
      },
    });
    if (!invite || !invite.chatRoom?.isGroup) return fail(res, 404, 'Invite not found');
    return res.json({
      code: invite.code,
      roomId: invite.chatRoom.id,
      roomName: invite.chatRoom.name,
      status: inviteStatus(invite),
    });
  } catch (error) {
    console.error('Resolve group invite failed:', error);
    return fail(res, 500, 'Could not resolve invite');
  }
});

router.post('/invites/:code/accept', requireAuth, async (req, res) => {
  const userId = validId(req.user?.id);
  if (!userId) return fail(res, 401, 'Authentication required');

  try {
    // The conditional usage increment is atomic. If creating membership fails,
    // Prisma rolls back the claimed invite usage in the same DB transaction.
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.chatRoomInvite.findUnique({
        where: { code: req.params.code },
        select: {
          id: true, chatRoomId: true, expiresAt: true,
          maxUses: true, uses: true,
          chatRoom: { select: { isGroup: true } },
        },
      });
      if (!invite || !invite.chatRoom?.isGroup) return { status: 404, error: 'Invite not found' };
      if (inviteStatus(invite) !== 'ok') return { status: 410, error: `Invite ${inviteStatus(invite)}` };
      const key = { chatRoomId_userId: { chatRoomId: invite.chatRoomId, userId } };
      const member = await tx.participant.findUnique({ where: key, select: { id: true } });
      if (member) return { status: 200, roomId: invite.chatRoomId, alreadyMember: true };

      const now = new Date();
      const claimed = await tx.chatRoomInvite.updateMany({
        where: {
          id: invite.id,
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ maxUses: 0 }, { uses: { lt: invite.maxUses } }] },
          ],
        },
        data: { uses: { increment: 1 } },
      });
      if (claimed.count !== 1) return { status: 410, error: 'Invite expired or exhausted' };
      await tx.participant.create({
        data: { chatRoomId: invite.chatRoomId, userId, role: 'MEMBER' },
      });
      return { status: 200, roomId: invite.chatRoomId, alreadyMember: false };
    });
    if (result.error) return fail(res, result.status, result.error);
    return res.json({ ok: true, roomId: result.roomId, alreadyMember: result.alreadyMember });
  } catch (error) {
    // Concurrent duplicate accepts may race on the unique membership key.
    // Their transaction rolls back; client can re-open the group safely.
    console.error('Accept group invite failed:', error);
    return fail(res, 409, 'Could not join group; please retry');
  }
});

export default router;
