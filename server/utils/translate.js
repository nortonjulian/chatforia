import crypto from 'crypto';
import { v2 } from '@google-cloud/translate';
import { ensureRedis } from './redisClient.js';

const { Translate } = v2;
const translate = new Translate({ key: process.env.GOOGLE_API_KEY });

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
    await r.setEx(key, ttlSec, translated);
  } catch {}

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

// not strictly required but nice for debugging in tests
export const __testInternals = { mem };
