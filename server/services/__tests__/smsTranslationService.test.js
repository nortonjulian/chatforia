import { jest, beforeEach, afterEach, test, expect } from '@jest/globals';

const messageFind = jest.fn();
const userFind = jest.fn();
const translate = jest.fn();
const allowance = jest.fn();
const cache = new Map();
const redis = {
  get: jest.fn(async (key) => cache.get(key) || null),
  set: jest.fn(async (key, value, options) => {
    if (options?.NX && cache.has(key)) return null;
    cache.set(key, value);
    return 'OK';
  }),
  setEx: jest.fn(async (key, _ttl, value) => { cache.set(key, value); }),
  eval: jest.fn(async (_script, { keys, arguments: args }) => {
    if (cache.get(keys[0]) === args[0]) cache.delete(keys[0]);
  }),
};
const ensureRedis = jest.fn(async () => redis);
const modulePath = (relative) => new URL(relative, import.meta.url).pathname;

await jest.unstable_mockModule(modulePath('../../utils/prismaClient.js'), () => ({
  default: {
    smsMessage: { findFirst: messageFind },
    user: { findUnique: userFind },
  },
}));
await jest.unstable_mockModule(modulePath('../../__tests__/mocks/redisClient.dynamic.js'), () => ({ ensureRedis }));
await jest.unstable_mockModule(modulePath('../translation/googleTranslate.js'), () => ({ translateText: translate }));
await jest.unstable_mockModule(modulePath('../translation/translationUsageService.js'), () => ({
  countTranslationCharacters: (text) => Array.from(text).length,
  withTranslationAllowance: allowance,
}));

const { translateIncomingSms } = await import(modulePath('../smsTranslationService.js'));
const originalFlag = process.env.TRANSLATION_ENABLED;
beforeEach(() => {
  process.env.TRANSLATION_ENABLED = 'true';
  cache.clear();
  jest.clearAllMocks();
  messageFind.mockResolvedValue({ id: 77, body: 'Hello there' });
  userFind.mockResolvedValue({
    preferredLanguage: 'es', autoTranslate: true,
    showOriginalWithTranslation: false, plan: 'PLUS',
  });
  translate.mockResolvedValue({ translated: 'Hola', provider: 'google' });
  allowance.mockImplementation(async ({ operation }) => operation());
});
afterEach(() => { process.env.TRANSLATION_ENABLED = originalFlag; });

test('checks ownership and inbound direction before reading or translating content', async () => {
  messageFind.mockResolvedValueOnce(null);
  await expect(translateIncomingSms(12, 77)).rejects.toMatchObject({ output: { statusCode: 404 } });
  expect(messageFind).toHaveBeenCalledWith({
    where: { id: 77, direction: 'in', thread: { userId: 12, deletedAt: null } },
    select: { id: true, body: true },
  });
  expect(userFind).not.toHaveBeenCalled();
  expect(translate).not.toHaveBeenCalled();
  await expect(translateIncomingSms(12, 'nope')).rejects.toMatchObject({ output: { statusCode: 400 } });
});

test('uses recipient preferences and preserves original without SMS writes or badges', async () => {
  const result = await translateIncomingSms(12, 77);
  expect(result).toMatchObject({
    messageId: 77, originalText: 'Hello there', translatedText: 'Hola',
    displayText: 'Hola', targetLanguage: 'es',
    showOriginalWithTranslation: false, status: 'translated',
  });
  expect(userFind).toHaveBeenCalledWith({ where: { id: 12 }, select: {
    preferredLanguage: true, autoTranslate: true,
    showOriginalWithTranslation: true, plan: true,
  } });
  expect(allowance).toHaveBeenCalledWith(expect.objectContaining({ userId: 12, plan: 'PLUS', amount: 11 }));
  expect(translate).toHaveBeenCalledWith('Hello there', 'es');
});

test('disabled preference, unavailable provider, and empty body return original without billing', async () => {
  userFind.mockResolvedValueOnce({ preferredLanguage: 'es', autoTranslate: false, showOriginalWithTranslation: true });
  expect(await translateIncomingSms(12, 77)).toMatchObject({ status: 'original', reason: 'disabled', displayText: 'Hello there' });
  process.env.TRANSLATION_ENABLED = 'false';
  expect(await translateIncomingSms(12, 77)).toMatchObject({ status: 'original', reason: 'unavailable' });
  process.env.TRANSLATION_ENABLED = 'true';
  messageFind.mockResolvedValueOnce({ id: 77, body: ' ' });
  expect(await translateIncomingSms(12, 77)).toMatchObject({ status: 'original', reason: 'empty' });
  expect(allowance).not.toHaveBeenCalled();
});

test('bounds work for oversized SMS text without changing the stored original', async () => {
  messageFind.mockResolvedValueOnce({ id: 77, body: 'x'.repeat(5001) });
  const result = await translateIncomingSms(12, 77);
  expect(result).toMatchObject({ status: 'original', reason: 'too_long', originalText: 'x'.repeat(5001) });
  expect(allowance).not.toHaveBeenCalled();
});

test('cache hit does not call provider or consume allowance again, and is recipient/language specific', async () => {
  await translateIncomingSms(12, 77);
  expect((await translateIncomingSms(12, 77)).translatedText).toBe('Hola');
  expect(allowance).toHaveBeenCalledTimes(1);
  await translateIncomingSms(13, 77);
  userFind.mockResolvedValueOnce({ preferredLanguage: 'fr', autoTranslate: true, showOriginalWithTranslation: true, plan: 'PLUS' });
  await translateIncomingSms(12, 77);
  messageFind.mockResolvedValueOnce({ id: 77, body: 'Edited original' });
  const changed = await translateIncomingSms(12, 77);
  expect(changed.originalText).toBe('Edited original');
  expect(allowance).toHaveBeenCalledTimes(4);
});

test('concurrent requests share one provider call and one allowance reservation', async () => {
  let release;
  translate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const first = translateIncomingSms(12, 77);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = translateIncomingSms(12, 77);
  release({ translated: 'Hola', provider: 'google' });
  const results = await Promise.all([first, second]);
  expect(results.map((result) => result.displayText)).toEqual(['Hola', 'Hola']);
  expect(allowance).toHaveBeenCalledTimes(1);
});

test('provider failure and allowance exhaustion return original without blocking delivery', async () => {
  translate.mockRejectedValueOnce(new Error('provider down'));
  expect(await translateIncomingSms(12, 77)).toMatchObject({ status: 'original', reason: 'unavailable' });
  allowance.mockRejectedValueOnce(Object.assign(new Error('limit'), { code: 'PLAN_ALLOWANCE_EXCEEDED' }));
  expect(await translateIncomingSms(12, 77)).toMatchObject({ status: 'original', reason: 'allowance_exhausted' });
});

test('cache outage fails closed to original before billing', async () => {
  ensureRedis.mockRejectedValueOnce(new Error('Redis down'));
  expect(await translateIncomingSms(12, 77)).toMatchObject({ status: 'original', reason: 'unavailable' });
  expect(allowance).not.toHaveBeenCalled();
});
