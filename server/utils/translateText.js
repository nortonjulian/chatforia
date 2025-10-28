import Boom from '@hapi/boom';
import { LRU } from './lru.js';
import { asyncPool } from './asyncPool.js';

// pull keys at module load (unchanged)
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DEEPL_KEY = process.env.DEEPL_API_KEY;

// test override: force provider behavior
// e.g. TRANSLATE_FORCE_PROVIDER=noop
const FORCE_PROVIDER = process.env.TRANSLATE_FORCE_PROVIDER || null;

// Cache config
const CACHE_TTL_MS = Number(
  process.env.TRANSLATE_CACHE_TTL_MS ?? 10 * 60 * 1000
);
const cache = new LRU(Number(process.env.TRANSLATE_CACHE_SIZE ?? 2000));

/** Provider: DeepL */
async function deeplTranslate({ text, targetLang, sourceLang }) {
  const resp = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      text,
      target_lang: targetLang.toUpperCase(),
      ...(sourceLang ? { source_lang: sourceLang.toUpperCase() } : {}),
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw Boom.badGateway(`DEEPL ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json();
  const translatedText = json?.translations?.[0]?.text ?? '';
  const detectedSourceLang =
    json?.translations?.[0]?.detected_source_language ??
    (sourceLang?.trim() || null);

  return { translatedText, detectedSourceLang, provider: 'deepl' };
}

/** Provider: OpenAI */
async function openaiTranslate({ text, targetLang, sourceLang }) {
  const system = `You are a translator. Translate the user's message to ${targetLang}. Return only the translation.`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.TRANSLATE_MODEL || 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        ...(sourceLang
          ? [{ role: 'system', content: `Source language hint: ${sourceLang}` }]
          : []),
        { role: 'user', content: text },
      ],
      max_tokens: 400,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw Boom.badGateway(`OpenAI ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = await resp.json();
  const translatedText = json?.choices?.[0]?.message?.content?.trim() ?? '';
  return {
    translatedText,
    detectedSourceLang: sourceLang?.trim() || null,
    provider: 'openai',
  };
}

/** Choose provider: DeepL → OpenAI → noop (with override support) */
async function translateOnce({ text, targetLang, sourceLang }) {
  // 🚦 test override wins completely
  if (FORCE_PROVIDER === 'noop') {
    return {
      translatedText: text,
      detectedSourceLang: sourceLang?.trim() || null,
      provider: 'noop',
    };
  }
  if (FORCE_PROVIDER === 'openai') {
    return openaiTranslate({ text, targetLang, sourceLang });
  }
  if (FORCE_PROVIDER === 'deepl') {
    return deeplTranslate({ text, targetLang, sourceLang });
  }

  // Normal runtime fallback chain
  if (DEEPL_KEY) {
    try {
      return await deeplTranslate({ text, targetLang, sourceLang });
    } catch (e) {
      if (!OPENAI_KEY) throw e;
      // else fall through to OpenAI
    }
  }

  if (OPENAI_KEY) {
    return openaiTranslate({ text, targetLang, sourceLang });
  }

  // Neither key available
  return {
    translatedText: text,
    detectedSourceLang: sourceLang?.trim() || null,
    provider: 'noop',
  };
}

/**
 * translateText({ text, targetLang, sourceLang?, extraTargets? })
 * ...unchanged below this point...
 */
export async function translateText({
  text,
  targetLang,
  sourceLang,
  extraTargets = [],
}) {
  if (!text || !targetLang)
    throw Boom.badRequest('text and targetLang required');

  const norm = (s) => (s ?? '').toString().trim();
  const t = norm(text);
  const tgt = norm(targetLang);
  const src = norm(sourceLang || '');

  const key = `v1|${src}|${tgt}|${t}`;
  if (cache.has(key)) {
    const cached = cache.get(key);
    return {
      text: t,
      translatedText: cached,
      translated: cached,
      targetLang: tgt,
      detectedSourceLang: src || null,
      provider: 'cache',
    };
  }

  const primary = await translateOnce({
    text: t,
    targetLang: tgt,
    sourceLang: src || undefined,
  });
  cache.set(key, primary.translatedText, CACHE_TTL_MS);

  const uniqueExtras = [...new Set(extraTargets.filter((x) => x && x !== tgt))];
  if (uniqueExtras.length) {
    const CONCURRENCY = Number(
      process.env.TRANSLATE_FANOUT_CONCURRENCY ?? 4
    );

    asyncPool(CONCURRENCY, uniqueExtras, async (lang) => {
      const k = `v1|${src}|${lang}|${t}`;
      if (cache.has(k)) return;
      try {
        const r = await translateOnce({
          text: t,
          targetLang: lang,
          sourceLang: src || undefined,
        });
        cache.set(k, r.translatedText, CACHE_TTL_MS);
      } catch {
        // ignore fanout errors
      }
    }).catch(() => {});
  }

  return {
    text: t,
    translatedText: primary.translatedText,
    translated: primary.translatedText,
    targetLang: tgt,
    detectedSourceLang: primary.detectedSourceLang ?? (src || null),
    provider: primary.provider,
  };
}
