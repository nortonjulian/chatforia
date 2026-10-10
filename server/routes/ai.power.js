import express from 'express';
import Boom from '@hapi/boom';
import prisma from '../utils/prismaClient.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePremium } from '../middleware/requirePremium.js';

const router = express.Router();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function llmChat(messages, { model = 'gpt-4o-mini', temperature = 0.2, max_tokens = 600 } = {}) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, temperature, max_tokens, messages }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw Boom.badGateway(`LLM error: ${res.status} ${txt || res.statusText}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

/** Premium-only: summarize last N messages in a room. */
router.post('/summarize-thread', requireAuth, requirePremium, async (req, res) => {
  const { chatRoomId, limit = 50, language = 'en' } = req.body || {};
  if (!chatRoomId) throw Boom.badRequest('chatRoomId required');

  const part = await prisma.participant.findFirst({
    where: { chatRoomId, userId: req.user.id },
  });
  if (!part) return res.status(403).json({ error: 'Forbidden' });

  const msgs = await prisma.message.findMany({
    where: { chatRoomId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 50, 200),
    select: { rawContent: true, senderId: true },
  });

  const text = msgs
    .reverse()
    .map((m) => `U${m.senderId}: ${m.rawContent || ''}`)
    .join('\n')
    .slice(0, 8000);

  const summary = await llmChat(
    [
      {
        role: 'system',
        content: `Summarize the conversation in ${language}. Bullet points. Keep it under 12 lines.`,
      },
      { role: 'user', content: text },
    ],
    { max_tokens: 400 }
  );

  res.json({ ok: true, summary });
});


export default router;
