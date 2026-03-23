import express from 'express';
import Boom from '@hapi/boom';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import blockWhenStrictE2EE from '../middleware/blockWhenStrictE2EE.js';
import { suggestReplies, rewriteText, chatWithRia } from '../services/riaService.js';

const r = express.Router();

r.use(requireAuth);
r.use(express.json());

// Smart replies
r.post('/suggest-replies', blockWhenStrictE2EE, asyncHandler(async (req, res) => {
  const { messages = [], draft = '', filterProfanity = false } = req.body || {};

  if (!Array.isArray(messages)) {
    throw Boom.badRequest('messages must be an array');
  }

  const normalizedMessages = messages
    .map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content || '').trim(),
    }))
    .filter((m) => m.content.length > 0)
    .slice(-12);

  const result = await suggestReplies({
    messages: normalizedMessages,
    draft: String(draft || ''),
    filterProfanity: Boolean(filterProfanity),
  });

  res.json(result);
}));

// Rewrite
r.post('/rewrite', blockWhenStrictE2EE, asyncHandler(async (req, res) => {
  const { text = '', tone = 'friendly', filterProfanity = false } = req.body || {};

  const clean = String(text || '').trim();
  if (!clean) {
    throw Boom.badRequest('text is required');
  }

  const result = await rewriteText({
    text: clean,
    tone: String(tone || 'friendly'),
    filterProfanity: Boolean(filterProfanity),
  });

  res.json(result);
}));

// Ria chat
r.post('/chat', blockWhenStrictE2EE, asyncHandler(async (req, res) => {
  const { messages = [], memoryEnabled = true, filterProfanity = false } = req.body || {};

  if (!Array.isArray(messages)) {
    throw Boom.badRequest('messages must be an array');
  }

  const normalizedMessages = messages
    .map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : 'user',
      content: String(m?.content || '').trim(),
    }))
    .filter((m) => m.content.length > 0)
    .slice(-20);

  if (normalizedMessages.length === 0) {
    throw Boom.badRequest('at least one message is required');
  }

    const result = await chatWithRia({
      userId: req.user.id,
      username: req.user.username || null,
      displayName: req.user.displayName || null,
      messages: normalizedMessages,
      memoryEnabled: Boolean(memoryEnabled),
      filterProfanity: Boolean(filterProfanity),
  });

  res.json(result);
}));

export default r;