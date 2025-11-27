import express from 'express';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();

import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /admin/voice-logs?status=&direction=&phone=&take=&skip=
router.get('/', async (req, res) => {
  try {
    const take = Math.min(parseInt(req.query.take ?? '50', 10), 200);
    const skip = parseInt(req.query.skip ?? '0', 10);
    const { status, direction, phone } = req.query;

    const where = {
      ...(status
        ? { status: status.toString().toUpperCase() }
        : {}),
      ...(direction
        ? { direction: direction.toString().toLowerCase() }
        : {}),
      ...(phone
        ? {
            OR: [
              { from: { contains: phone, mode: 'insensitive' } },
              { to: { contains: phone, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.voiceLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
        skip,
      }),
      prisma.voiceLog.count({ where }),
    ]);

    res.json({ items, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch voice logs' });
  }
});

export default router;
