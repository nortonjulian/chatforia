import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const take = Number(req.query.take ?? 50);
    const skip = Number(req.query.skip ?? 0);
    const query = String(req.query.query ?? '').trim();

    if (
      !Number.isSafeInteger(take) ||
      take < 1 ||
      take > 200 ||
      !Number.isSafeInteger(skip) ||
      skip < 0 ||
      query.length > 100
    ) {
      return res.status(400).json({
        error: 'Invalid user listing parameters',
      });
    }

    const where = query
      ? {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          role: true,
          isBanned: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return res.json({ items, total });
  } catch (error) {
    console.error('Admin user listing failed', error);
    return res.status(500).json({
      error: 'Failed to list users',
    });
  }
});

export default router;
