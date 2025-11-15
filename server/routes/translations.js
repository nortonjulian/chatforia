import express from 'express';
import Boom from '@hapi/boom';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import { translateBatch } from '../services/translation/index.js';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// --- translate batch (unchanged) ---
const translateLimiter = rateLimit({
  windowMs: 15 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) =>
    req.user?.id ? String(req.user.id) : ipKeyGenerator(req, res),
});

router.post('/batch', requireAuth, translateLimiter, async (req, res, next) => {
  try {
    const userId = Number(req.user?.id);
    const { items = [], target } = req.body || {};
    if (!Array.isArray(items) || !items.length) throw Boom.badRequest('items required');

    let targetLanguage = (typeof target === 'string' && target) || 'en';
    if (!req.body?.target) {
      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { preferredLanguage: true },
      });
      if (me?.preferredLanguage) targetLanguage = me.preferredLanguage;
    }

    const texts = items.map(i => String(i.text || ''));
    const results = await translateBatch(texts, targetLanguage);

    const out = items.map((it, i) => ({
      id: it.id,
      translatedText: results[i]?.text || '',
      detectedSourceLanguage: results[i]?.detectedSourceLanguage || null,
      targetLanguage,
    }));

    return res.json({ translations: out });
  } catch (err) {
    next(err.isBoom ? err : Boom.badImplementation(err.message));
  }
});

// --- helpers ---
function setNested(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}

function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
    return b ?? a;
  }
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = k in a ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}

// --- Serve translation JSON for i18next backend ---
router.get('/', async (req, res, next) => {
  try {
    const rawLng = String(req.query.lng || 'en');
    const ns = String(req.query.ns || 'translation'); // i18next default
    const lng = rawLng.split('-')[0]; // cs-CZ -> cs

    // 1) Load file JSON: client/public/locales/<lng>/<ns>.json
    const filePath = path.resolve(process.cwd(), 'client/public/locales', lng, `${ns}.json`);
    let fileJson = {};
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      fileJson = JSON.parse(raw);
    } catch {
      fileJson = {}; // no file found, keep going
    }

    // 2) Load DB rows (optional overrides)
    let dbJson = {};
    try {
      const rows = await prisma.translation.findMany({
        where: { language: lng }, // or rawLng if your table stores full tags like cs-CZ
        select: { key: true, value: true },
      });
      for (const { key, value } of rows) {
        // rows are flat "dot.notation" keys -> build nested object
        setNested(dbJson, key, value);
      }
    } catch {
      dbJson = {};
    }

    // 3) Merge (DB overrides file)
    const payload = deepMerge(fileJson, dbJson);

    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err) {
    next(err.isBoom ? err : Boom.badImplementation(err.message));
  }
});

export default router;
