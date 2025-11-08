let detectLanguageMock;
let translateTextMock;
let getCachedMock;
let setCachedMock;

const mockDeps = () => {
  detectLanguageMock = jest.fn();
  translateTextMock = jest.fn();
  getCachedMock = jest.fn();
  setCachedMock = jest.fn();

  jest.doMock('../googleTranslate.js', () => ({
    __esModule: true,
    detectLanguage: detectLanguageMock,
    translateText: translateTextMock,
  }));

  jest.doMock('../cache.js', () => ({
    __esModule: true,
    getCached: getCachedMock,
    setCached: setCachedMock,
  }));
};

const reload = async () => {
  jest.resetModules();
  mockDeps();
  return import('../translateMessage.js');
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('maybeTranslateForTarget', () => {
  test('returns fallback when originalText empty or target missing', async () => {
    const { maybeTranslateForTarget } = await reload();

    await expect(maybeTranslateForTarget('', 'en', 'es')).resolves.toEqual({
      translatedText: null,
      detectedLang: null,
      confidence: null,
      provider: 'none',
    });

    await expect(maybeTranslateForTarget('Hello', 'en', '')).resolves.toEqual({
      translatedText: null,
      detectedLang: null,
      confidence: null,
      provider: 'none',
    });

    expect(getCachedMock).not.toHaveBeenCalled();
    expect(detectLanguageMock).not.toHaveBeenCalled();
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  test('explicit source equals target → skip translation, return detectedLang only, no cache writes', async () => {
    const { maybeTranslateForTarget } = await reload();

    const out = await maybeTranslateForTarget('Bonjour', 'FR', 'fr');
    expect(out).toEqual({
      translatedText: null,
      detectedLang: 'fr',
      confidence: null,
      provider: 'none',
    });

    expect(getCachedMock).not.toHaveBeenCalled();
    expect(setCachedMock).not.toHaveBeenCalled();
    expect(detectLanguageMock).not.toHaveBeenCalled();
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  test('cache hit short-circuits detection/translation', async () => {
    const { maybeTranslateForTarget } = await reload();

    const cached = {
      translatedText: 'hola',
      detectedLang: 'en',
      confidence: 0.9,
      provider: 'google',
    };
    getCachedMock.mockReturnValueOnce(cached);

    const out = await maybeTranslateForTarget('Hello', null, 'es');
    expect(out).toBe(cached);
    expect(getCachedMock).toHaveBeenCalledTimes(1);
    const keyArg = getCachedMock.mock.calls[0][0];
    expect(keyArg).toContain('v1:auto:es:Hello');
    expect(detectLanguageMock).not.toHaveBeenCalled();
    expect(translateTextMock).not.toHaveBeenCalled();
  });

  test('detected language equals target → no translation, caches result', async () => {
    const { maybeTranslateForTarget } = await reload();

    getCachedMock.mockReturnValueOnce(null);
    detectLanguageMock.mockResolvedValueOnce({
      language: 'ES',
      confidence: 0.88,
      provider: 'google',
    });

    const out = await maybeTranslateForTarget('hola mundo', null, 'es');
    expect(out).toEqual({
      translatedText: null,
      detectedLang: 'es',
      confidence: 0.88,
      provider: 'google',
    });

    expect(translateTextMock).not.toHaveBeenCalled();
    expect(setCachedMock).toHaveBeenCalledTimes(1);
    const [keySet, valSet] = setCachedMock.mock.calls[0];
    expect(keySet).toContain(':es:hola mundo');
    expect(valSet).toEqual(out);
  });

  test('detection throws → proceed with provider="google" then translate', async () => {
    const { maybeTranslateForTarget } = await reload();

    getCachedMock.mockReturnValueOnce(null);
    detectLanguageMock.mockRejectedValueOnce(new Error('api down'));
    translateTextMock.mockResolvedValueOnce({ translated: 'bonjour', provider: 'google' });

    const out = await maybeTranslateForTarget('hello', null, 'fr');
    expect(out).toEqual({
      translatedText: 'bonjour',
      detectedLang: null, // because detection failed and no explicit src
      confidence: null,
      provider: 'google',
    });

    expect(detectLanguageMock).toHaveBeenCalled();
    expect(translateTextMock).toHaveBeenCalledWith('hello', 'fr');
    expect(setCachedMock).toHaveBeenCalledTimes(1);
  });

  test('translation success → uses translated text, carries confidence/provider, caches', async () => {
    const { maybeTranslateForTarget } = await reload();

    getCachedMock.mockReturnValueOnce(null);
    detectLanguageMock.mockResolvedValueOnce({
      language: 'en',
      confidence: 0.73,
      provider: 'google',
    });
    translateTextMock.mockResolvedValueOnce({ translated: 'hola', provider: 'google' });

    const out = await maybeTranslateForTarget('hello', null, 'es');
    expect(out).toEqual({
      translatedText: 'hola',
      detectedLang: 'en',
      confidence: 0.73,
      provider: 'google',
    });

    expect(setCachedMock).toHaveBeenCalledTimes(1);
    const saved = setCachedMock.mock.calls[0][1];
    expect(saved).toEqual(out);
  });

  test('translation throws → returns null translated with detection metadata, caches', async () => {
    const { maybeTranslateForTarget } = await reload();

    getCachedMock.mockReturnValueOnce(null);
    detectLanguageMock.mockResolvedValueOnce({
      language: 'de',
      confidence: 0.6,
      provider: 'google',
    });
    translateTextMock.mockRejectedValueOnce(new Error('quota'));

    const out = await maybeTranslateForTarget('hallo welt', null, 'fr');
    expect(out).toEqual({
      translatedText: null,
      detectedLang: 'de',
      confidence: 0.6,
      provider: 'google',
    });

    expect(setCachedMock).toHaveBeenCalledTimes(1);
  });

  test('explicit source different from target → skip detect, go straight to translate', async () => {
    const { maybeTranslateForTarget } = await reload();

    getCachedMock.mockReturnValueOnce(null);
    translateTextMock.mockResolvedValueOnce({ translated: 'ciao', provider: 'google' });

    const out = await maybeTranslateForTarget('hello', 'EN', 'it');
    expect(detectLanguageMock).not.toHaveBeenCalled();
    expect(translateTextMock).toHaveBeenCalledWith('hello', 'it');
    expect(out).toEqual({
      translatedText: 'ciao',
      detectedLang: 'en',
      confidence: null,
      provider: 'google',
    });
  });
});
