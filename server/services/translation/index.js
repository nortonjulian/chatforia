import * as googleMod from './googleTranslate.js';

function resolveGoogleImpl(mod) {
  if (typeof mod.translateBatchGoogle === 'function') return mod.translateBatchGoogle;
  if (typeof mod.translateBatch === 'function') return mod.translateBatch;
  if (typeof mod.default === 'function') return mod.default;
  if (mod.default && typeof mod.default.translateBatch === 'function') return mod.default.translateBatch;
  throw new Error(
    'googleTranslate.js must export translateBatchGoogle(), translateBatch(), a default function, or default { translateBatch }'
  );
}

const googleTranslate = resolveGoogleImpl(googleMod);

export async function translateBatch(texts = [], targetLanguage = 'en') {
  const arr = Array.isArray(texts) ? texts : [String(texts || '')];
  if (arr.length === 0) return [];

  const results = await googleTranslate(arr, targetLanguage);

  return (results || []).map((r) => ({
    text: r?.text ?? r?.translatedText ?? '',
    detectedSourceLanguage:
      r?.detectedSourceLanguage ?? r?.source ?? r?.detectedLanguageCode ?? null,
  }));
}
