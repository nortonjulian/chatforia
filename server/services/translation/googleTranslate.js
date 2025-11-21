import { v2 as TranslateV2 } from '@google-cloud/translate';
import pRetry from 'p-retry';

const { Translate } = TranslateV2;

const RETRIES = 3;

function isEnabled() {
  return process.env.TRANSLATION_ENABLED === 'true';
}

let client = null;

// Lazy-init Google Translate client.
// In tests, @google-cloud/translate is mocked and this constructor is spied on.
function getClient() {
  if (!client) {
    const projectId = process.env.GOOGLE_PROJECT_ID;
    // Tests expect exactly { projectId: 'chatforia-xyz' } when set,
    // and don't assert anything when projectId is missing.
    client = projectId ? new Translate({ projectId }) : new Translate({});
  }
  return client;
}

/**
 * Detect language of a single text.
 * - If disabled or empty text → { language: null, confidence: null, provider: 'none' }
 * - If enabled → uses client.detect via p-retry({ retries: 3 })
 */
export async function detectLanguage(text) {
  if (!isEnabled() || !text) {
    return {
      language: null,
      confidence: null,
      provider: 'none',
    };
  }

  const translate = getClient();

  // client.detect(text) resolves to [detections]
  const [detections] = await pRetry(
    () => translate.detect(text),
    { retries: RETRIES }
  );

  // detections can be an object or an array of objects
  const first = Array.isArray(detections) ? detections[0] : detections || {};

  return {
    language: first.language || null,
    confidence:
      typeof first.confidence === 'number' ? first.confidence : null,
    provider: 'google',
  };
}

/**
 * Translate a single text.
 * - Disabled or blank inputs → { translated: null, provider: 'none' }
 * - Enabled → uses client.translate via p-retry({ retries: 3 })
 */
export async function translateText(text, targetLang) {
  if (!isEnabled() || !text || !targetLang) {
    return {
      translated: null,
      provider: 'none',
    };
  }

  const translate = getClient();

  // client.translate(text, targetLang) resolves to [translated]
  let [translated] = await pRetry(
    () => translate.translate(text, targetLang),
    { retries: RETRIES }
  );

  // If API ever returns an array here, pick the first element
  if (Array.isArray(translated)) {
    translated = translated[0];
  }

  return {
    translated,
    provider: 'google',
  };
}

/**
 * Translate a batch of texts (or a single string).
 * - Disabled → echoes inputs with detectedSourceLanguage: null
 * - Enabled → always calls client.translate with an array, and normalizes output
 *   to: [{ translatedText, detectedSourceLanguage }, ...]
 */
export async function translateBatch(texts, targetLang) {
  // Normalize input to an array of strings
  const inputArray = Array.isArray(texts) ? texts : [texts];

  if (!isEnabled()) {
    // Echo back inputs without calling Google
    return inputArray.map((t) => ({
      translatedText: t,
      detectedSourceLanguage: null,
    }));
  }

  const translate = getClient();

  // Always pass an array to the client
  let [translated] = await pRetry(
    () => translate.translate(inputArray, targetLang),
    { retries: RETRIES }
  );

  // Google can return:
  // - ['hola']               (single string)
  // - [['un', 'deux']]       (array-of-strings for batch)
  if (!Array.isArray(translated)) {
    // single string → wrap in array
    translated = [translated];
  }

  return inputArray.map((src, idx) => ({
    translatedText:
      translated[idx] !== undefined ? translated[idx] : translated[0],
    detectedSourceLanguage: null,
  }));
}
