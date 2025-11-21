import crypto from 'crypto';
import { v2 } from '@google-cloud/translate';
import { ensureRedis } from './redisClient.js';

const { Translate } = v2;

// Support both production and test env var names
const apiKey =
  process.env.GOOGLE_TRANSLATE_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  null;

// Optional feature flag: if explicitly set to 'false', disable even if key exists
const translationFlag = process.env.TRANSLATION_ENABLED;

// Enabled if:
//  - TRANSLATION_ENABLED === 'true', OR
//  - we have an API key and TRANSLATION_ENABLED is not explicitly 'false'
const enabled =
  translationFlag === 'true' ||
  (!!apiKey && translationFlag !== 'false');

// Only hard-fail if user explicitly turned translation ON but no key is present
if (translationFlag === 'true' && !apiKey) {
  throw new Error('GOOGLE_TRANSLATE_API_KEY or GOOGLE_API_KEY is not set');
}

// When enabled + apiKey, create a real (or mocked) client
const translate = enabled && apiKey ? new Translate({ key: apiKey }) : null;

// small in-memory fallback cache
const mem = new Map();
const MEM_MAX = 500;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const memGet = (k) => mem.get(k);
const memSet = (k, v) => {
  mem.set(k, v);
  if (mem.size > MEM_MAX) {
    mem.delete(mem.keys().next().value); // delete oldest
  }
};

async function translateWithCache(text, lang, ttlSec = 60 * 60 * 24 * 30) {
  // If not enabled or no client, just echo the original
  if (!enabled || !translate) return text;

  const key = `tr:${sha256(text)}:${lang}`;

  // 1. memory
  const inMem = memGet(key);
  if (inMem) return inMem;

  // 2. redis
  try {
    const r = await ensureRedis(); // will be fake in tests, redisKv in prod
    const cached = await r.get(key);
    if (cached) {
      memSet(key, cached);
      return cached;
    }
  } catch {
    // ignore redis errors in runtime
  }

  // 3. live translate
  const [translated] = await translate.translate(text, lang);

  // 4. write-through cache
  memSet(key, translated);
  try {
    const r = await ensureRedis();
    // In tests, ensureRedis().setEx writes into __redisTestStore
    await r.setEx(key, ttlSec, translated);
  } catch {
    // ignore redis errors
  }

  return translated;
}

export async function translateForTargets(content, senderLang, targetLangs) {
  const unique = [
    ...new Set((targetLangs || []).filter((l) => l && l !== senderLang)),
  ];

  if (!content || unique.length === 0) {
    return { map: {}, from: senderLang };
  }

  const map = {};
  for (const lang of unique) {
    try {
      map[lang] = await translateWithCache(content, lang);
    } catch (err) {
      console.error(`Translation to ${lang} failed:`, err);
    }
  }

  return { map, from: senderLang };
}

export async function translateOne(content, lang) {
  if (!content || !lang) return null;
  return translateWithCache(content, lang);
}

export const __testInternals = { mem };
