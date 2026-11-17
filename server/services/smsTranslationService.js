import crypto from 'node:crypto';

import Boom from '@hapi/boom';

import db from '../utils/prismaClient.js';
import { ensureRedis } from '../utils/redisClient.js';

import { translateText } from './translation/googleTranslate.js';
import {
  countTranslationCharacters,
  withTranslationAllowance,
} from './translation/translationUsageService.js';

const CACHE_SECONDS = 24 * 60 * 60;
const MAX_TRANSLATABLE_CHARACTERS = 5000;
const LOCK_MILLISECONDS = 60 * 1000;
const WAIT_ATTEMPTS = 20;
const WAIT_MILLISECONDS = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function originalResponse(message, user, reason) {
  return {
    messageId: message.id,
    originalText: message.body,
    translatedText: null,
    displayText: message.body,
    targetLanguage: user.preferredLanguage || 'en',
    showOriginalWithTranslation: user.showOriginalWithTranslation,
    status: 'original',
    reason,
  };
}

// Cache only a successful provider result. The digest keeps SMS content out of
// Redis keys; the value remains private recipient content and expires in 24h.
function cacheKey(userId, message, language) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([userId, message.id, language, message.body]))
    .digest('hex');
  return `sms-translation:v1:${digest}`;
}

export async function translateIncomingSms(userId, messageId) {
  const uid = Number(userId);
  const mid = Number(messageId);
  if (!Number.isSafeInteger(uid) || uid <= 0 ||
      !Number.isSafeInteger(mid) || mid <= 0) {
    throw Boom.badRequest('Valid SMS message id is required');
  }

  // Ownership and direction are checked in the same query that reads the body.
  const message = await db.smsMessage.findFirst({
    where: {
      id: mid,
      direction: 'in',
      thread: { userId: uid, deletedAt: null },
    },
    select: { id: true, body: true },
  });
  if (!message) throw Boom.notFound('Incoming SMS message not found');

  const user = await db.user.findUnique({
    where: { id: uid },
    select: {
      preferredLanguage: true,
      autoTranslate: true,
      showOriginalWithTranslation: true,
      plan: true,
    },
  });
  if (!user) throw Boom.notFound('User not found');
  const fallback = (reason) => originalResponse(message, user, reason);
  if (!user.autoTranslate) return fallback('disabled');
  if (!message.body?.trim()) return fallback('empty');
  const amount = countTranslationCharacters(message.body);
  if (amount > MAX_TRANSLATABLE_CHARACTERS) return fallback('too_long');
  if (process.env.TRANSLATION_ENABLED !== 'true') return fallback('unavailable');

  const language = String(user.preferredLanguage || 'en').trim().toLowerCase();
  const key = cacheKey(uid, message, language);
  let redis;
  try {
    redis = await ensureRedis();
  } catch {
    return fallback('unavailable');
  }

  const fromCache = async () => {
    const value = await redis.get(key);
    if (!value) return null;
    const parsed = JSON.parse(value);
    return typeof parsed?.translatedText === 'string' && parsed.translatedText
      ? parsed.translatedText : null;
  };
  const translatedResponse = (text) => ({
    ...fallback(null),
    translatedText: text,
    displayText: text,
    targetLanguage: language,
    status: 'translated',
    reason: null,
  });

  try {
    const hit = await fromCache();
    if (hit) return translatedResponse(hit);
  } catch {
    return fallback('unavailable');
  }

  const lockKey = `${key}:lock`;
  const token = crypto.randomUUID();
  let acquired;
  try {
    acquired = await redis.set(lockKey, token, { NX: true, PX: LOCK_MILLISECONDS });
  } catch {
    return fallback('unavailable');
  }
  if (acquired !== 'OK') {
    for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt += 1) {
      await sleep(WAIT_MILLISECONDS);
      try {
        const hit = await fromCache();
        if (hit) return translatedResponse(hit);
      } catch {
        break;
      }
    }
    return fallback('pending');
  }

  try {
    // A result may have appeared between the initial read and lock acquisition.
    const hit = await fromCache();
    if (hit) return translatedResponse(hit);

    const result = await withTranslationAllowance({
      userId: uid,
      plan: user.plan || 'FREE',
      amount,
      operation: () => translateText(message.body, language),
      shouldBillResult: (out) => out?.provider === 'google' && !!out?.translated,
    });
    if (!result?.translated || result.provider !== 'google') {
      return fallback('unavailable');
    }

    const translatedText = String(result.translated);
    try {
      await redis.setEx(key, CACHE_SECONDS, JSON.stringify({ translatedText }));
    } catch {
      // The translation is usable, but a later retry may incur another charge.
    }
    return translatedResponse(translatedText);
  } catch (error) {
    return fallback(error?.code === 'PLAN_ALLOWANCE_EXCEEDED' ? 'allowance_exhausted' : 'unavailable');
  } finally {
    try {
      await redis.eval(
        'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end',
        { keys: [lockKey], arguments: [token] }
      );
    } catch {
      // TTL releases the lock if Redis cannot process the compare-and-delete.
    }
  }
}
