import express from 'express';
import asyncHandler from 'express-async-handler';
import { requireAuth } from '../middleware/auth.js';
import { toE164 } from '../utils/phone.js';

import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = new PrismaClient();
const router = express.Router();

// For search only: strip to digits/+ so "415-555-2671" works as a substring
const normalizeForSearch = (s) => (s || '').toString().replace(/[^\d+]/g, '');

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
    const qDigits = normalizeForSearch(q);

    const where = {
      ownerId,
      ...(q
        ? {
            OR: [
              { alias: { contains: q, mode: 'insensitive' } },
              { externalName: { contains: q, mode: 'insensitive' } },
              ...(qDigits ? [{ externalPhone: { contains: qDigits } }] : []),
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
        externalPhone: true, // E.164 if present
        externalName: true,
        createdAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
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
// Upsert by { userId } OR { externalPhone (E.164) }
// ------------------------------
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
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
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
      });
    } else {
      // Normalize to E.164 using req.region as fallback when not starting with '+'
      const normalized =
        externalPhone?.startsWith('+')
          ? toE164(externalPhone) // region-less parse
          : toE164(externalPhone, req.region || 'US');

      if (!normalized) {
        return res.status(400).json({ error: 'Invalid phone number.' });
      }

      contact = await prisma.contact.upsert({
        where: { ownerId_externalPhone: { ownerId, externalPhone: normalized } },
        update: {
          alias: alias ?? undefined,
          externalName: externalName ?? undefined,
          favorite: typeof favorite === 'boolean' ? favorite : undefined,
        },
        create: {
          ownerId,
          externalPhone: normalized, // ✅ store E.164 only
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
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
      });
    }

    res.status(201).json(contact);
  })
);

// ------------------------------
// PATCH /contacts  (update by userId or externalPhone)
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

    let where;
    if (userId) {
      where = { ownerId_userId: { ownerId, userId: Number(userId) } };
    } else {
      // Ensure externalPhone path uses normalized E.164 to match unique index
      const normalized =
        externalPhone?.startsWith('+')
          ? toE164(externalPhone)
          : toE164(externalPhone, req.region || 'US');

      if (!normalized) {
        return res.status(400).json({ error: 'Invalid phone number.' });
      }

      where = { ownerId_externalPhone: { ownerId, externalPhone: normalized } };
    }

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
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    res.json(updated);
  })
);

// ------------------------------
// DELETE /contacts (by userId or externalPhone)
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

    let where;
    if (userId) {
      where = { ownerId_userId: { ownerId, userId: Number(userId) } };
    } else {
      const normalized =
        externalPhone?.startsWith('+')
          ? toE164(externalPhone)
          : toE164(externalPhone, req.region || 'US');

      if (!normalized) {
        return res.status(400).json({ error: 'Invalid phone number.' });
      }

      where = { ownerId_externalPhone: { ownerId, externalPhone: normalized } };
    }

    await prisma.contact.delete({ where });
    res.json({ success: true });
  })
);

// ------------------------------
// DELETE /contacts/:id (optional helper)
// ------------------------------
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const contactId = Number(req.params.id);
    const ownerId = Number(req.user.id);

    const c = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { ownerId: true },
    });
    if (!c || c.ownerId !== ownerId) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    await prisma.contact.delete({ where: { id: contactId } });
    res.json({ success: true });
  })
);

// Debug route
router.get('/_debug_me', requireAuth, (req, res) => {
  res.json({ id: req.user?.id, region: req.region, typeof: typeof req.user?.id });
});

export default router;
