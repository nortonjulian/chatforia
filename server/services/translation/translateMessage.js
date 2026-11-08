import { getCached, setCached } from './cache.js';
import { translateText } from './googleTranslate.js';

// Reserve allowance only when provider work is actually necessary. Cached and
// explicit same-language results remain available after the allowance is spent.
export async function maybeTranslateForTarget(
  originalText, explicitSourceLang, targetLang,
  { runBillable = (operation) => operation() } = {},
) {
  const fallback = { translatedText: null, detectedLang: null, confidence: null, provider: 'none' };
  if (!originalText?.trim() || !targetLang) return fallback;

  const srcLang = explicitSourceLang ? String(explicitSourceLang).toLowerCase() : null;
  const tgt = String(targetLang).toLowerCase();
  if (srcLang && srcLang === tgt) return { ...fallback, detectedLang: srcLang };

  const key = `v1:${srcLang || 'auto'}:${tgt}:${originalText}`;
  const cached = getCached(key);
  if (cached) return { ...cached, provider: 'cache' };

  return runBillable(async () => {
    // Another request may have populated the cache while reservation awaited.
    const ready = getCached(key);
    if (ready) return { ...ready, provider: 'cache' };

    // Google detects the source within this request without a second paid call.
    // Let errors propagate so the allowance reservation is released. Do not
    // cache failures: a later request must be able to recover.
    const { translated, provider, detectedSourceLanguage } =
      await translateText(originalText, tgt);
    const detected = String(detectedSourceLanguage || srcLang || '').toLowerCase();
    const val = {
      translatedText: detected === tgt ? null : translated || null,
      detectedLang: detected || null,
      confidence: null,
      provider: provider || 'none',
    };
    if (val.provider !== 'none' && (translated || detected === tgt)) {
      setCached(key, val);
    }
    return val;
  });
}
