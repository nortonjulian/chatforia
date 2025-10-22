import express from 'express';
import asyncHandler from 'express-async-handler';
import { requireAuth } from '../middleware/auth.js';
import { digitsOnly } from '../utils/phone.js';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;

const prisma = new PrismaClient();
const router = express.Router();

router.get(
  '/',
  requireAuth, // ✅ ensure req.user exists
  asyncHandler(async (req, res) => {
    const ownerId = Number(req.user?.id);
    if (!ownerId) return res.status(401).json({ error: 'Unauthorized' });

    const q = String(req.query.q || '').trim();
    const qDigits = digitsOnly(q);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 25);

    // Early out on empty query
    if (!q) return res.json({ items: [] });

    // ---------------------------
    // Contacts (by alias/name/digits + linked username)
    // ---------------------------
    const contacts = await prisma.contact.findMany({
      where: {
        ownerId,
        OR: [
          { alias: { contains: q, mode: 'insensitive' } },
          { externalName: { contains: q, mode: 'insensitive' } },
          ...(qDigits ? [{ externalPhone: { contains: qDigits } }] : []),
          // Relation filter needs `is`
          { user: { is: { username: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      take: limit,
      select: {
        id: true,
        alias: true,
        externalName: true,
        externalPhone: true,
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    // ---------------------------
    // Users (username/email)
    // ---------------------------
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: limit,
      select: { id: true, username: true, avatarUrl: true, phoneNumber: true },
    });

    // ---------------------------
    // SMS Threads (match any participant by digits substring)
    // ---------------------------
    let threads = [];
    if (qDigits && prisma.smsThread) {
      // Some deployments might not have this model yet — the guard above avoids a runtime crash.
      // We pull a capped recent set and filter by digits in app space.
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

    // ---------------------------
    // Ranking / merge
    // ---------------------------
    const exactPhoneContact =
      qDigits ? contacts.find((c) => digitsOnly(c.externalPhone || '') === qDigits) : null;

    const scored = [
      ...contacts.map((c) => ({
        kind: 'contact',
        id: c.id,
        label: c.alias || c.externalName || c.user?.username || c.externalPhone,
        phone: c.externalPhone || null,
        userId: c.user?.id || null,
        avatarUrl: c.user?.avatarUrl || null,
        score: exactPhoneContact && exactPhoneContact.id === c.id ? 100 : 70,
        lastMessageAt: null,
      })),
      ...users.map((u) => ({
        kind: 'user',
        id: u.id,
        label: u.username || u.email || `User #${u.id}`,
        phone: u.phoneNumber || null,
        userId: u.id,
        avatarUrl: u.avatarUrl || null,
        score: (u.username || '').toLowerCase() === q.toLowerCase() ? 80 : 50,
        lastMessageAt: null,
      })),
      ...threads.map((t) => ({
        kind: 'sms_thread',
        id: t.id,
        label: Array.isArray(t.participants) ? t.participants.join(', ') : '',
        phone: null,
        userId: null,
        avatarUrl: null,
        score: 60,
        lastMessageAt: t.lastMessageAt ? new Date(t.lastMessageAt).getTime() : 0,
      })),
    ];

    // De-dupe by kind:id, keep highest score
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
