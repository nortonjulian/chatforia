import express from 'express';
import asyncHandler from 'express-async-handler';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();
const router = express.Router();

const digits = (s = '') => s.replace(/[^\d]/g, '');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const ownerId = Number(req.user.id);
    const q = String(req.query.q || '').trim();
    const qDigits = digits(q);
    const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 25);

    if (!qDigits) return res.json({ items: [] });

    // If you denormalized participantsDigits, query via contains
    // Otherwise, fetch recent threads then filter in app (still OK for small N)
    const threads = await prisma.smsThread.findMany({
      where: { ownerId },
      orderBy: { lastMessageAt: 'desc' },
      take: 100, // cap then filter; adjust if you have huge volumes
      select: { id: true, participants: true, lastMessageAt: true },
    });

    const items = threads.filter(t =>
      (t.participants || []).some(p => digits(p).includes(qDigits))
    ).slice(0, limit);

    res.json({ items });
  })
);

export default router;
