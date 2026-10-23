import express from 'express';
import rateLimit from 'express-rate-limit';
import asyncHandler from 'express-async-handler';
import { requireAuth } from '../middleware/auth.js';
import { digitsOnly } from '../utils/phone.js';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;

const prisma = new PrismaClient();
const router = express.Router();

const peopleSearchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id || 'authenticated-user'),
  message: { error: 'Too many searches. Please try again shortly.' },
});

router.get(
  '/',
  requireAuth,
  peopleSearchLimiter,
  asyncHandler(async (req, res) => {
    const ownerId = Number(req.user?.id);
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const q = String(req.query.q || '').trim();
    const qDigits = digitsOnly(q);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 12);

    if (!q) return res.json({ items: [] });

    const contacts = await prisma.contact.findMany({
      where: {
        ownerId,
        OR: [
          { alias: { contains: q, mode: 'insensitive' } },
          { externalName: { contains: q, mode: 'insensitive' } },
          ...(qDigits ? [{ externalPhone: { contains: qDigits } }] : []),
          { user: { is: { username: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      take: limit,
      select: {
        id: true,
        alias: true,
        externalName: true,
        externalPhone: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Public account discovery intentionally requires 3+ characters and never paginates.
    const users = q.length >= 3
      ? await prisma.user.findMany({
          where: {
            id: { not: ownerId },
            isBanned: false,
            isSystem: false,
            isTestAccount: false,
            deletedAt: null,
            AND: [
              {
                OR: [
                  { username: { contains: q, mode: 'insensitive' } },
                  { displayName: { contains: q, mode: 'insensitive' } },
                ],
              },
              {
                OR: [
                  { discoverability: 'EVERYONE' },
                  {
                    discoverability: 'CONTACTS_ONLY',
                    contactsSaved: { some: { ownerId } },
                  },
                ],
              },
            ],
          },
          take: limit,
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        })
      : [];

    // Only inspect block records that could affect this result set. This avoids both
    // unbounded block-history reads and arbitrary caps that could allow older blocks through.
    const candidateUserIds = [
      ...users.map((u) => Number(u.id)),
      ...contacts.map((c) => Number(c.user?.id)).filter(Number.isFinite),
    ].filter((id, index, all) => id !== ownerId && all.indexOf(id) === index);

    const blockedUserIds = new Set();
    if (candidateUserIds.length > 0) {
      const blocks = await prisma.userBlock.findMany({
        where: {
          OR: [
            { blockerId: ownerId, blockedId: { in: candidateUserIds } },
            { blockedId: ownerId, blockerId: { in: candidateUserIds } },
          ],
        },
        select: { blockerId: true, blockedId: true },
      });
      for (const block of blocks) {
        blockedUserIds.add(Number(block.blockerId) === ownerId
          ? Number(block.blockedId) : Number(block.blockerId));
      }
    }

    const visibleUsers = users.filter((u) => !blockedUserIds.has(Number(u.id)));
    const visibleContacts = contacts.filter(
      (c) => !c.user?.id || !blockedUserIds.has(Number(c.user.id))
    );

    let threads = [];
    if (qDigits && prisma.smsThread) {
      const recent = await prisma.smsThread.findMany({
        where: { ownerId },
        orderBy: { lastMessageAt: 'desc' },
        take: 100,
        select: { id: true, participants: true, lastMessageAt: true },
      });

      threads = recent
        .filter(
          (t) =>
            Array.isArray(t.participants) &&
            t.participants.some((p) => digitsOnly(p).includes(qDigits))
        )
        .slice(0, limit);
    }

    const exactPhoneContact =
      qDigits
        ? visibleContacts.find((c) => digitsOnly(c.externalPhone || '') === qDigits)
        : null;

    const scored = [
      ...visibleContacts.map((c) => ({
        kind: 'contact',
        id: c.id,
        label: c.alias || c.externalName || c.user?.displayName || c.user?.username || c.externalPhone,
        username: c.user?.username || null,
        displayName: c.user?.displayName || c.externalName || null,
        phone: c.externalPhone || null,
        userId: c.user?.id || null,
        avatarUrl: c.user?.avatarUrl || null,
        score: exactPhoneContact && exactPhoneContact.id === c.id ? 100 : 70,
        lastMessageAt: null,
      })),
      ...visibleUsers.map((u) => ({
        kind: 'user',
        id: u.id,
        label: u.displayName || u.username || `User #${u.id}`,
        username: u.username,
        displayName: u.displayName || null,
        phone: null,
        userId: u.id,
        avatarUrl: u.avatarUrl || null,
        score:
          (u.username || '').toLowerCase() === q.toLowerCase()
            ? 90
            : (u.displayName || '').toLowerCase() === q.toLowerCase()
              ? 80
              : 50,
        lastMessageAt: null,
      })),
      ...threads.map((t) => ({
        kind: 'sms_thread',
        id: t.id,
        label: Array.isArray(t.participants) ? t.participants.join(', ') : '',
        username: null,
        displayName: null,
        phone: null,
        userId: null,
        avatarUrl: null,
        score: 60,
        lastMessageAt: t.lastMessageAt ? new Date(t.lastMessageAt).getTime() : 0,
      })),
    ];

    const map = new Map();
    for (const x of scored) {
      const key = `${x.kind}:${x.id}`;
      const prev = map.get(key);
      if (!prev || x.score > prev.score) map.set(key, x);
    }

    const items = [...map.values()]
      .sort(
        (a, b) =>
          b.score - a.score || (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
      )
      .slice(0, limit);

    res.json({ items });
  })
);

export default router;
