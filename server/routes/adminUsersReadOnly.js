import express from 'express';

import { requireAuth, requireAdmin } from '../middleware/auth.js';
import database from '../utils/prismaClient.js';

export function createAdminUsersReadOnlyRouter({
  db = database,
  authenticate = requireAuth,
  authorize = requireAdmin,
} = {}) {
  const router = express.Router();
  router.use(authenticate, authorize);
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

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
        db.user.findMany({
          where,
          take,
          skip,
          orderBy: { id: 'desc' },
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            isBanned: true,
          },
        }),
        db.user.count({ where }),
      ]);

      return res.json({ items, total });
    } catch (error) {
      console.error('Admin user listing failed', error);
      return res.status(500).json({
        error: 'Failed to list users',
      });
    }
  });

  return router;
}
export default createAdminUsersReadOnlyRouter();
