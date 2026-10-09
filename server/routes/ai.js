import express from 'express';
import Boom from '@hapi/boom';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import blockWhenStrictE2EE from '../middleware/blockWhenStrictE2EE.js';
import { suggestReplies, rewriteText, chatWithRia } from '../services/riaService.js';
import { getPlanEntitlements } from '../config/planEntitlements.js';
import {
  assertAndConsumeUsage,
  releaseUsage,
} from '../services/planUsageService.js';

const r = express.Router();

async function withRiaAllowance(req, operation) {
  await assertAndConsumeUsage({
    userId: req.user.id,
    plan: req.user.plan,
    meter: 'riaActions',
    amount: 1,
  });

  try {
    return await operation();
  } catch (err) {
    try {
      await releaseUsage({
        userId: req.user.id,
        meter: 'riaActions',
        amount: 1,
      });
    } catch (releaseErr) {
      console.error('Failed to release Ria allowance', releaseErr);
    }

    throw err;
  }
}

function requireComposerAiEntitlement(
  req,
  feature = 'AI tools'
) {
  const entitlements = getPlanEntitlements(req.user?.plan);

  if (entitlements.aiRewriteLevel === 'NONE') {
    const verb =
      feature === 'AI rewrite'
        ? 'requires'
        : 'require';

    throw Boom.paymentRequired(
      `${feature} ${verb} Chatforia Plus or Premium`
    );
  }

  return entitlements.aiRewriteLevel;
}

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

  requireComposerAiEntitlement(req, 'AI smart replies');

  const result = await withRiaAllowance(req, () =>
    suggestReplies({
      messages: normalizedMessages,
      draft: String(draft || ''),
      filterProfanity: Boolean(filterProfanity),
    }),
  );

  res.json(result);
}));

// Rewrite
r.post('/rewrite', blockWhenStrictE2EE, asyncHandler(async (req, res) => {
  const { text = '', tone = 'friendly', filterProfanity = false } = req.body || {};

  const clean = String(text || '').trim();
  if (!clean) {
    throw Boom.badRequest('text is required');
  }

  requireComposerAiEntitlement(req, 'AI rewrite');

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

  const result = await withRiaAllowance(req, () =>
    chatWithRia({
      userId: req.user.id,
      username: req.user.username || null,
      displayName: req.user.displayName || null,
      messages: normalizedMessages,
      memoryEnabled: Boolean(memoryEnabled),
      filterProfanity: Boolean(filterProfanity),
    }),
  );

  res.json(result);
}));

export default r;