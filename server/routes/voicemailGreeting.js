import express from 'express';
import multer from 'multer';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { uploadBufferToStorage } from '../utils/storage.js';

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// All routes require auth
r.use(requireAuth);

/**
 * POST /api/voicemail/greeting
 *
 * Upload an audio file to be used as the user's voicemail greeting.
 * Expects multipart/form-data with field: "file"
 */
r.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);

    if (!req.file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    const { buffer, mimetype, originalname } = req.file;

    // Generate a storage key/path for this greeting
    const key = `voicemail-greetings/${userId}-${Date.now()}-${originalname.replace(
      /\s+/g,
      '_',
    )}`;

    // Upload to your storage provider (R2/S3/etc.)
    // This should return a public or signed URL that Twilio can access.
    const url = await uploadBufferToStorage({
      key,
      buffer,
      contentType: mimetype || 'audio/mpeg',
    });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        voicemailGreetingUrl: url,
      },
      select: {
        voicemailGreetingUrl: true,
      },
    });

    res.json({ greetingUrl: user.voicemailGreetingUrl });
  }),
);

/**
 * POST /api/voicemail/greeting/text
 *
 * Set a text fallback greeting (used if no audio greeting is set).
 * Body: { greetingText: string | null }
 */
r.post(
  '/text',
  express.json(),
  asyncHandler(async (req, res) => {
    const userId = Number(req.user.id);
    const { greetingText } = req.body ?? {};

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        voicemailGreetingText: greetingText || null,
      },
      select: {
        voicemailGreetingText: true,
      },
    });

    res.json({ greetingText: user.voicemailGreetingText });
  }),
);

export default r;
