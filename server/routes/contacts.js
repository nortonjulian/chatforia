import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from 'express-async-handler';

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();
const router = express.Router();

const normalizePhone = (s) => (s || '').toString().replace(/[^\d+]/g, '');

// ------------------------------
// GET /contacts
// ------------------------------
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ownerId = Number(req.user.id);

    const limitRaw = Number(req.query.limit ?? 50);
    const limit = Math.min(Math.max(1, limitRaw), 100);
    const cursorId = req.query.cursor ? Number(req.query.cursor) : null;

    const q = (req.query.q || '').toString().trim();
    const qDigits = normalizePhone(q);

    const where = {
      ownerId,
      ...(q
        ? {
            OR: [
              { alias: { contains: q, mode: 'insensitive' } },
              { externalName: { contains: q, mode: 'insensitive' } },
              ...(qDigits ? [{ externalPhone: { contains: qDigits } }] : []),
              // Search linked user by username only (no displayName in schema)
              {
                user: {
                  username: { contains: q, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const items = await prisma.contact.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: {
        id: true,
        alias: true,
        favorite: true,
        externalPhone: true,
        externalName: true,
        createdAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true, // removed displayName
          },
        },
      },
    });

    const nextCursor = items.length === limit ? items[items.length - 1].id : null;
    res.json({ items, nextCursor, count: items.length });
  })
);

// ------------------------------
// POST /contacts
// Upsert by { userId } OR { externalPhone }
// ------------------------------
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const ownerId = Number(req.user.id);
      let { userId, alias, externalPhone, externalName, favorite } = req.body;

      if (process.env.NODE_ENV !== 'production') {
        console.log('[contacts.post] ownerId=%s body=%o', ownerId, {
          userId,
          alias,
          externalPhone,
          externalName,
          favorite,
        });
      }

      if (!userId && !externalPhone) {
        return res.status(400).json({ error: 'Provide userId or externalPhone' });
      }

      let contact;
      if (userId) {
        contact = await prisma.contact.upsert({
          where: { ownerId_userId: { ownerId, userId: Number(userId) } },
          update: {
            alias: alias ?? undefined,
            favorite: typeof favorite === 'boolean' ? favorite : undefined,
          },
          create: {
            ownerId,
            userId: Number(userId),
            alias: alias ?? undefined,
            favorite: !!favorite,
          },
          select: {
            id: true,
            alias: true,
            favorite: true,
            externalPhone: true,
            externalName: true,
            createdAt: true,
            user: { select: { id: true, username: true, avatarUrl: true } }, // removed displayName
          },
        });
      } else {
        externalPhone = normalizePhone(externalPhone);
        if (!externalPhone) {
          return res.status(400).json({ error: 'externalPhone invalid' });
        }

        contact = await prisma.contact.upsert({
          where: { ownerId_externalPhone: { ownerId, externalPhone } },
          update: {
            alias: alias ?? undefined,
            externalName: externalName ?? undefined,
            favorite: typeof favorite === 'boolean' ? favorite : undefined,
          },
          create: {
            ownerId,
            externalPhone,
            externalName: externalName ?? null,
            alias: alias ?? undefined,
            favorite: !!favorite,
          },
          select: {
            id: true,
            alias: true,
            favorite: true,
            externalPhone: true,
            externalName: true,
            createdAt: true,
            user: { select: { id: true, username: true, avatarUrl: true } }, // removed displayName
          },
        });
      }

      res.status(201).json(contact);
    } catch (err) {
      console.error('[contacts.post] error:', err);
      if (process.env.NODE_ENV !== 'production') {
        return res
          .status(500)
          .json({ error: 'Internal Server Error', detail: String(err?.message || err) });
      }
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  })
);

// ------------------------------
// PATCH /contacts
// ------------------------------
router.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ownerId = Number(req.user.id);
    let { userId, externalPhone, alias, externalName, favorite } = req.body;

    if (!userId && !externalPhone) {
      return res.status(400).json({ error: 'Provide userId or externalPhone' });
    }

    const where = userId
      ? { ownerId_userId: { ownerId, userId: Number(userId) } }
      : {
          ownerId_externalPhone: {
            ownerId,
            externalPhone: normalizePhone(externalPhone),
          },
        };

    const updated = await prisma.contact.update({
      where,
      data: {
        alias: alias ?? undefined,
        externalName: externalName ?? undefined,
        favorite: typeof favorite === 'boolean' ? favorite : undefined,
      },
      select: {
        id: true,
        alias: true,
        favorite: true,
        externalPhone: true,
        externalName: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatarUrl: true } }, // removed displayName
      },
    });

    res.json(updated);
  })
);

// ------------------------------
// DELETE /contacts
// ------------------------------
router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ownerId = Number(req.user.id);
    let { userId, externalPhone } = req.body;

    if (!userId && !externalPhone) {
      return res.status(400).json({ error: 'Provide userId or externalPhone' });
    }

    const where = userId
      ? { ownerId_userId: { ownerId, userId: Number(userId) } }
      : {
          ownerId_externalPhone: {
            ownerId,
            externalPhone: normalizePhone(externalPhone),
          },
        };

    await prisma.contact.delete({ where });
    res.json({ success: true });
  })
);

// Optional helper
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const contactId = Number(req.params.id);
    const ownerId = Number(req.user.id);

    const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { ownerId: true } });
    if (!c || c.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await prisma.contact.delete({ where: { id: contactId } });
    res.json({ success: true });
  })
);

router.get('/_debug_me', requireAuth, (req, res) => {
  res.json({ id: req.user?.id, typeof: typeof req.user?.id });
});

export default router;
