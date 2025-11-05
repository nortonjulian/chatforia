import express from 'express';
import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Optional: allow STT for everyone in dev by setting STT_FREE=true
const STT_FREE = String(process.env.STT_FREE || '').toLowerCase() === 'true';

// Fallback cache if Transcript table isn't present yet
// Map<messageId, { segments: Array<{text:string}>, createdAt:number }>
const MEM_TRANSCRIPTS = new Map();

async function isParticipant(chatRoomId, userId) {
  if (!Number.isFinite(chatRoomId) || !Number.isFinite(userId)) return false;
  const p = await prisma.participant.findFirst({
    where: { chatRoomId, userId },
    select: { id: true },
  });
  return !!p;
}

/**
 * POST /media/:messageId/transcribe
 * - Verifies membership
 * - Premium-gates unless STT_FREE=true
 * - For now, writes a placeholder transcript (replace with real STT enqueue)
 */
router.post('/media/:messageId/transcribe', requireAuth, async (req, res) => {
  const messageId = Number(req.params.messageId);
  if (!Number.isFinite(messageId)) throw Boom.badRequest('Invalid id');

  const userId = Number(req.user?.id);
  const plan = String(req.user?.plan || '').toUpperCase();
  const isPremium = plan === 'PREMIUM';

  try {
    // Ensure the message exists and has audio
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, audioUrl: true, chatRoomId: true },
    });
    if (!msg || !msg.audioUrl) return res.json({ ok: true }); // no-op

    // Membership check
    const okMember = await isParticipant(msg.chatRoomId, userId);
    if (!okMember) throw Boom.forbidden('Not a participant in this chat');

    // Premium gating (unless STT_FREE)
    if (!STT_FREE && !isPremium) {
      return res.status(402).json({ ok: false, reason: 'PREMIUM_REQUIRED' });
    }

    // TODO: enqueue real STT job here. For now, write a stub so UI shows something.
    const stub = {
      segments: [
        { text: '(transcript coming soon)' },
      ],
      createdAt: Date.now(),
    };

    // Try DB upsert; fall back to memory if the table isn't there yet
    try {
      await prisma.transcript.upsert({
        where: { messageId },
        create: { messageId, transcript: { segments: stub.segments } },
        update: { transcript: { segments: stub.segments } },
      });
    } catch {
      MEM_TRANSCRIPTS.set(messageId, stub);
    }

    return res.json({ ok: true });
  } catch (e) {
    const code = e?.output?.statusCode || 500;
    return res.status(code).json({ error: 'Transcription failed' });
  }
});

/**
 * GET /transcripts/:messageId
 * Always 200 with shape: { transcript: { segments: [...] } | null }
 * (Avoid 404 so the client can decide how to render.)
 */
router.get('/transcripts/:messageId', requireAuth, async (req, res) => {
  const messageId = Number(req.params.messageId);
  if (!Number.isFinite(messageId)) return res.status(400).json({ transcript: null });

  // Prefer DB if available
  try {
    const t = await prisma.transcript.findUnique({
      where: { messageId },
      select: { transcript: true },
    });
    if (t?.transcript) return res.json({ transcript: t.transcript });
  } catch {
    // swallow if table not created yet
  }

  // Memory fallback
  const mem = MEM_TRANSCRIPTS.get(messageId);
  if (mem) return res.json({ transcript: { segments: mem.segments } });

  // Not ready yet: return empty transcript (200)
  return res.json({ transcript: { segments: [] } });
});

export default router;
