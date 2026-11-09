import { jest } from '@jest/globals';

const translateText = jest.fn();
const detectLanguage = jest.fn();
const consume = jest.fn();
const release = jest.fn();
await jest.unstable_mockModule('../translation/googleTranslate.js', () => ({ translateText, detectLanguage }));
await jest.unstable_mockModule('../planUsageService.js', () => ({
  assertAndConsumeUsage: consume, releaseUsage: release,
}));

let translate;
let withTranslationAllowance;
const oldTTL = process.env.TRANSLATION_CACHE_TTL_SECONDS;
beforeEach(async () => {
  jest.resetModules();
  jest.resetAllMocks();
  process.env.TRANSLATION_CACHE_TTL_SECONDS = '60';
  ({ maybeTranslateForTarget: translate } = await import('../translation/translateMessage.js'));
  ({ withTranslationAllowance } = await import('../translation/translationUsageService.js'));
  translateText.mockResolvedValue({ translated: 'hola', provider: 'google', detectedSourceLanguage: 'en' });
});
afterAll(() => {
  if (oldTTL === undefined) delete process.env.TRANSLATION_CACHE_TTL_SECONDS;
  else process.env.TRANSLATION_CACHE_TTL_SECONDS = oldTTL;
});
const options = () => ({
  runBillable: operation => withTranslationAllowance({
    userId: 1, plan: 'PLUS', amount: 5, operation,
    shouldBillResult: result => result.provider === 'google',
  }),
});

test('blank input and explicit same-language skip provider and reservation', async () => {
  expect((await translate('', null, 'es', options())).provider).toBe('none');
  expect((await translate('hello', 'EN', 'en', options())).detectedLang).toBe('en');
  expect(consume).not.toHaveBeenCalled();
  expect(translateText).not.toHaveBeenCalled();
});

test('one provider call auto-detects language and consumes allowance once', async () => {
  expect(await translate('hello', null, 'es', options())).toEqual({
    translatedText: 'hola', detectedLang: 'en', confidence: null, provider: 'google',
  });
  expect(consume).toHaveBeenCalledTimes(1);
  expect(consume).toHaveBeenCalledWith({userId: 1, plan: 'PLUS', meter: 'translationChars', amount: 5, date: expect.any(Date)});
  expect(translateText).toHaveBeenCalledTimes(1);
  expect(detectLanguage).not.toHaveBeenCalled();
});

test('real cache hit remains available at exhausted quota without another reservation', async () => {
  const first = await translate('hello', null, 'es', options());
  consume.mockRejectedValue(new Error('allowance exhausted'));
  expect(await translate('hello', null, 'es', options())).toEqual({...first, provider: 'cache'});
  expect(first.provider).toBe('google');
  expect(consume).toHaveBeenCalledTimes(1);
  expect(translateText).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
});

test('cache miss cannot call the provider when allowance is exhausted', async () => {
  consume.mockRejectedValue(new Error('allowance exhausted'));
  await expect(translate('hello', null, 'es', options())).rejects.toThrow('allowance exhausted');
  expect(translateText).not.toHaveBeenCalled();
});

test('failed provider call releases allowance and is not cached', async () => {
  translateText.mockRejectedValueOnce(new Error('provider failed'));
  await expect(translate('hello', null, 'es', options())).rejects.toThrow('provider failed');
  expect(release).toHaveBeenCalledTimes(1);
  expect((await translate('hello', null, 'es', options())).translatedText).toBe('hola');
  expect(translateText).toHaveBeenCalledTimes(2);
});

test('disabled provider releases allowance and does not poison cache', async () => {
  translateText.mockResolvedValueOnce({ translated: null, provider: 'none' });
  expect((await translate('hello', null, 'es', options())).provider).toBe('none');
  expect(release).toHaveBeenCalledTimes(1);
  expect((await translate('hello', null, 'es', options())).translatedText).toBe('hola');
  expect(translateText).toHaveBeenCalledTimes(2);
});

test('auto-detected same language preserves no-translation result and caches paid work', async () => {
  translateText.mockResolvedValue({ translated: 'hello', provider: 'google', detectedSourceLanguage: 'en' });
  expect((await translate('hello', null, 'en', options())).translatedText).toBeNull();
  expect((await translate('hello', null, 'en', options())).provider).toBe('cache');
  expect(consume).toHaveBeenCalledTimes(1);
});

test('cache populated while reservation awaits refunds the unnecessary reservation', async () => {
  consume.mockImplementationOnce(async () => { await translate('hello', null, 'es'); });
  expect((await translate('hello', null, 'es', options())).provider).toBe('cache');
  expect(translateText).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

test('cache expiry requires a new reservation and provider call', async () => {
  const clock = jest.spyOn(Date, 'now');
  try {
    clock.mockReturnValue(1000);
    await translate('hello', null, 'es', options());
    clock.mockReturnValue(62000);
    await translate('hello', null, 'es', options());
    expect(consume).toHaveBeenCalledTimes(2);
    expect(translateText).toHaveBeenCalledTimes(2);
  } finally { clock.mockRestore(); }
});
