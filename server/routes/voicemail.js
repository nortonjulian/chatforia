import express from 'express';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { emitToUser } from '../services/socketBus.js';
import { fetchTwilioMedia } from '../utils/twilioMediaProxy.js';

const r = express.Router();

// All voicemail routes require auth
r.use(requireAuth);

/**
 * GET /api/voicemail
 *
 * Return the current user's voicemails (excluding soft-deleted),
 * newest first.
 */
r.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);

    const voicemails = await prisma.voicemail.findMany({
      where: {
        userId,
        deleted: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    res.json({ voicemails });
  }),
);

/**
 * GET /api/voicemail/:id/audio
 *
 * Securely proxy a voicemail recording from Twilio.
 * The Twilio Auth Token remains on the backend.
 */
r.get(
  '/:id/audio',
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const { id } = req.params;

    const voicemail = await prisma.voicemail.findFirst({
      where: {
        id,
        userId,
        deleted: false,
      },
      select: {
        audioUrl: true,
      },
    });

    if (!voicemail?.audioUrl) {
      return res.status(404).json({
        error: 'Voicemail audio not found',
      });
    }

    const upstream = await fetchTwilioMedia(voicemail.audioUrl);

    const contentType =
      upstream.headers.get('content-type') || 'audio/mpeg';

    const contentLength =
      upstream.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');

    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    if (
      upstream.body &&
      typeof upstream.body.pipe === 'function'
    ) {
      return upstream.body.pipe(res);
    }

    const arrayBuffer = await upstream.arrayBuffer();

    return res.status(200).send(
      Buffer.from(arrayBuffer)
    );
  }),
);

/**
 * PATCH /api/voicemail/:id/read
 *
 * Body: { isRead?: boolean }
 * Mark a voicemail as read/unread for the current user.
 */
r.patch(
  '/:id/read',
  express.json(),
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const { id } = req.params;
    const { isRead = true } = req.body ?? {};

    const result = await prisma.voicemail.updateMany({
      where: {
        id,
        userId,
        deleted: false,
      },
      data: {
        isRead: Boolean(isRead),
      },
    });

        if (result.count === 0) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    emitToUser(userId, 'voicemail:updated', {
      id,
      isRead: Boolean(isRead),
    });

    res.json({ success: true });
  }),
);

/**
 * DELETE /api/voicemail/:id
 *
 * Soft delete a voicemail for the current user.
 */
r.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const { id } = req.params;

    const result = await prisma.voicemail.updateMany({
      where: {
        id,
        userId,
        deleted: false,
      },
        data: {
          deleted: true,
          deletedAt: new Date(),
      },
    });

        if (result.count === 0) {
      return res.status(404).json({ error: 'Voicemail not found' });
    }

    emitToUser(userId, 'voicemail:deleted', { id });

    res.json({ success: true });
  }),
);

export default r;
