import { jest } from '@jest/globals';

// We'll be re-importing the module multiple times with different env.
// In ESM + Jest, the cleanest pattern is:
//  - save original env
//  - tweak process.env
//  - do dynamic import() of the module
//  - assert
//  - restore env after each test

const TEN_MB = 10 * 1024 * 1024;

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // reset env so each test starts clean
  process.env = { ...ORIGINAL_ENV };
  // Also clear the Jest module registry cache to force a re-import.
  jest.resetModules();
});

describe('uploadConfig env-driven exports', () => {
  test('defaults when env vars are not set', async () => {
    delete process.env.STORAGE_DRIVER;
    delete process.env.MAX_FILE_SIZE_BYTES;

    // force a fresh import with those envs
    jest.resetModules();
    const mod = await import('../../utils/uploadConfig.js');

    const {
      STORAGE_DRIVER,
      MAX_FILE_SIZE_BYTES,
      ALLOWED_MIME,
      MIME_EXT,
    } = mod;

    // STORAGE_DRIVER default
    expect(STORAGE_DRIVER).toBe('local');

    // MAX_FILE_SIZE_BYTES default (10 MB)
    expect(MAX_FILE_SIZE_BYTES).toBe(TEN_MB);

    // sanity: ALLOWED_MIME should be a Set containing core types
    expect(ALLOWED_MIME instanceof Set).toBe(true);
    expect(ALLOWED_MIME.has('image/jpeg')).toBe(true);
    expect(ALLOWED_MIME.has('image/png')).toBe(true);
    expect(ALLOWED_MIME.has('image/gif')).toBe(true);
    expect(ALLOWED_MIME.has('image/webp')).toBe(true);
    expect(ALLOWED_MIME.has('application/pdf')).toBe(true);
    expect(ALLOWED_MIME.has('text/plain')).toBe(true);

    // video/mp4 intentionally not allowed (we're checking we didn't loosen policy)
    expect(ALLOWED_MIME.has('video/mp4')).toBe(false);

    // MIME_EXT correctness for known mimes
    expect(MIME_EXT['image/jpeg']).toBe('jpg');
    expect(MIME_EXT['application/pdf']).toBe('pdf');
    expect(MIME_EXT['text/plain']).toBe('txt');
    // unmapped mime should be undefined
    expect(MIME_EXT['video/mp4']).toBeUndefined();
  });

  test('STORAGE_DRIVER lowercases env value', async () => {
    process.env.STORAGE_DRIVER = 'S3';

    jest.resetModules();
    const mod = await import('../../utils/uploadConfig.js');

    expect(mod.STORAGE_DRIVER).toBe('s3');
  });

  test('MAX_FILE_SIZE_BYTES respects env override', async () => {
    process.env.MAX_FILE_SIZE_BYTES = '5242880'; // 5 MB

    jest.resetModules();
    const mod = await import('../../utils/uploadConfig.js');

    expect(mod.MAX_FILE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});
