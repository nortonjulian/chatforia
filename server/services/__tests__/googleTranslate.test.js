const ORIGINAL_ENV = process.env;

let translateCtorSpy;
let detectMock;
let translateMock;
let pRetryCallSpy;

const mockTranslateModule = () => {
  // client methods for v2
  detectMock = jest.fn();
  translateMock = jest.fn();

  // constructor spy (captures projectId)
  translateCtorSpy = jest.fn().mockImplementation((opts) => {
    return {
      detect: detectMock,
      translate: translateMock,
    };
  });

  // @google-cloud/translate v2 exports { v2: { Translate: class … } }
  jest.doMock('@google-cloud/translate', () => ({
    __esModule: true,
    v2: { Translate: translateCtorSpy },
  }));
};

const mockPRetryModule = () => {
  pRetryCallSpy = jest.fn();
  // p-retry default export is a function(fn, opts)
  jest.doMock('p-retry', () => ({
    __esModule: true,
    default: (fn, opts) => {
      pRetryCallSpy(opts);
      return fn();
    },
  }));
};

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  mockTranslateModule();
  mockPRetryModule();

  return import('../googleTranslate.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('googleTranslate service', () => {
  test('detectLanguage: disabled or empty text → provider "none"', async () => {
    const { detectLanguage } = await reload({
      TRANSLATION_ENABLED: 'false',
    });

    // disabled
    await expect(detectLanguage('hello')).resolves.toEqual({
      language: null,
      confidence: null,
      provider: 'none',
    });
    expect(translateCtorSpy).not.toHaveBeenCalled();
    expect(pRetryCallSpy).not.toHaveBeenCalled();

    // disabled + empty
    await expect(detectLanguage('')).resolves.toEqual({
      language: null,
      confidence: null,
      provider: 'none',
    });
  });

  test('detectLanguage: enabled → calls client.detect via p-retry and maps result', async () => {
    const { detectLanguage } = await reload({
      TRANSLATION_ENABLED: 'true',
      GOOGLE_PROJECT_ID: 'chatforia-prod',
    });

    // client.detect returns [detections]; detections can be obj or array-of-obj
    detectMock.mockResolvedValueOnce([
      { language: 'es', confidence: 0.76 },
    ]);

    const out = await detectLanguage('Hola, mundo');
    expect(translateCtorSpy).toHaveBeenCalledWith({
      projectId: 'chatforia-prod',
    });
    expect(detectMock).toHaveBeenCalledWith('Hola, mundo');
    expect(pRetryCallSpy).toHaveBeenCalledWith({ retries: 3 });

    expect(out).toEqual({
      language: 'es',
      confidence: 0.76,
      provider: 'google',
    });
  });

  test('translateText: disabled or blank inputs → provider "none"', async () => {
    const { translateText } = await reload({
      TRANSLATION_ENABLED: 'false',
    });

    await expect(translateText('hello', 'es')).resolves.toEqual({
      translated: null,
      provider: 'none',
    });

    const { translateText: translateText2 } = await reload({
      TRANSLATION_ENABLED: 'true',
    });

    await expect(translateText2('', 'es')).resolves.toEqual({
      translated: null,
      provider: 'none',
    });
    await expect(translateText2('hello', '')).resolves.toEqual({
      translated: null,
      provider: 'none',
    });
  });

  test('translateText: enabled → calls client.translate via p-retry and maps result', async () => {
    const { translateText } = await reload({
      TRANSLATION_ENABLED: 'true',
      GOOGLE_PROJECT_ID: 'chatforia-dev',
    });

    translateMock.mockResolvedValueOnce(['hola']);

    const out = await translateText('hello', 'es');
    expect(translateCtorSpy).toHaveBeenCalledWith({ projectId: 'chatforia-dev' });
    expect(translateMock).toHaveBeenCalledWith('hello', 'es');
    expect(pRetryCallSpy).toHaveBeenCalledWith({ retries: 3 });
    expect(out).toEqual({ translated: 'hola', provider: 'google' });
  });

  test('translateBatch: disabled → echoes inputs with detectedSourceLanguage=null', async () => {
    const { translateBatch } = await reload({
      TRANSLATION_ENABLED: 'false',
    });

    const out1 = await translateBatch(['a', 'b'], 'fr');
    expect(out1).toEqual([
      { translatedText: 'a', detectedSourceLanguage: null },
      { translatedText: 'b', detectedSourceLanguage: null },
    ]);

    const out2 = await translateBatch('single', 'fr');
    expect(out2).toEqual([
      { translatedText: 'single', detectedSourceLanguage: null },
    ]);
  });

  test('translateBatch: enabled → passes array to client.translate and maps strings to objects', async () => {
    const { translateBatch } = await reload({
      TRANSLATION_ENABLED: 'true',
      GOOGLE_PROJECT_ID: 'chatforia-prod',
    });

    translateMock.mockResolvedValueOnce([['un', 'deux']]);

    const out = await translateBatch(['one', 'two'], 'fr');

    expect(translateCtorSpy).toHaveBeenCalledWith({ projectId: 'chatforia-prod' });
    expect(translateMock).toHaveBeenCalledWith(['one', 'two'], 'fr');
    expect(pRetryCallSpy).toHaveBeenCalledWith({ retries: 3 });
    expect(out).toEqual([
      { translatedText: 'un', detectedSourceLanguage: null },
      { translatedText: 'deux', detectedSourceLanguage: null },
    ]);
  });

  test('translateBatch: enabled and API returns a single string (non-array) → still normalized to list', async () => {
    const { translateBatch } = await reload({
      TRANSLATION_ENABLED: 'true',
    });

    // API returns a single string when input was a single string
    translateMock.mockResolvedValueOnce(['hola']);

    const out = await translateBatch('hello', 'es');
    expect(translateMock).toHaveBeenCalledWith(['hello'], 'es'); // we pass an array
    expect(out).toEqual([{ translatedText: 'hola', detectedSourceLanguage: null }]);
  });
});
