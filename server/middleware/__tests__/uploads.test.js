const ORIGINAL_ENV = process.env;

// ---- Mocks ----
const fsMock = { mkdirSync: jest.fn() };
jest.mock('fs', () => fsMock);

// Multer mock: capture options & expose storages
const memoryStorageMock = jest.fn(() => ({ _type: 'memory' }));
const diskStorageMock = jest.fn((opts) => ({ _type: 'disk', _opts: opts }));

const multerCalls = [];
const makeMulterReturn = (opts) => {
  // Return a callable middleware with metadata + .single/.array stubs
  const mw = jest.fn((req, res, next) => next && next());
  mw._opts = opts;
  mw.single = (_field) => jest.fn((req, res, next) => next && next());
  mw.array = (_field, _max) => jest.fn((req, res, next) => next && next());
  return mw;
};

const multerMock = jest.fn((opts) => {
  multerCalls.push(opts);
  return makeMulterReturn(opts);
});
multerMock.memoryStorage = memoryStorageMock;
multerMock.diskStorage = diskStorageMock;

jest.mock('multer', () => ({
  __esModule: true,
  default: (...args) => multerMock(...args),
}));

// Helper: (re)load module under a specific env
const reloadModule = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  // reset per-import capture
  fsMock.mkdirSync.mockClear();
  multerMock.mockClear();
  memoryStorageMock.mockClear();
  diskStorageMock.mockClear();
  multerCalls.length = 0;

  // Import fresh
  return import('../uploads.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('uploads middleware', () => {
  test('creates upload directories on import', async () => {
    const UPLOADS_DIR = '/tmp/foria-test-uploads';
    const mod = await reloadModule({ UPLOADS_DIR });

    // mkdirSync should be called for ROOT, AVATARS_DIR, MEDIA_DIR
    expect(fsMock.mkdirSync).toHaveBeenCalledTimes(3);

    const { uploadDirs } = mod;
    expect(uploadDirs.ROOT).toBe(UPLOADS_DIR);
    expect(uploadDirs.AVATARS_DIR).toBe(`${UPLOADS_DIR}/avatars`);
    expect(uploadDirs.MEDIA_DIR).toBe(`${UPLOADS_DIR}/media`);

    // All calls include { recursive: true }
    fsMock.mkdirSync.mock.calls.forEach(([p, opts]) => {
      expect(typeof p).toBe('string');
      expect(opts).toMatchObject({ recursive: true });
    });
  });

  test('singleUploadMemory uses memory storage and 1-file/25MB limits', async () => {
    const mod = await reloadModule({ NODE_ENV: 'test' }); // env doesn’t affect this

    // There will be 3 multer() calls total on import (single + avatar + media).
    expect(multerMock).toHaveBeenCalled();

    // Find the call for singleUploadMemory by its limits
    const singleCall = multerCalls.find(
      (opts) => opts?.limits?.files === 1 && opts?.limits?.fileSize === 25 * 1024 * 1024
    );
    expect(singleCall).toBeTruthy();
    expect(memoryStorageMock).toHaveBeenCalled(); // memory storage used
    expect(singleCall.fileFilter).toEqual(expect.any(Function));
    expect(mod.singleUploadMemory).toEqual(expect.any(Function));
  });

  test('avatar/media uploaders use MEMORY storage by default (UPLOAD_TARGET=memory)', async () => {
    const mod = await reloadModule({ UPLOAD_TARGET: 'memory' });

    // Calls include avatar (files:1, 5MB) and media (files:10, 100MB)
    const avatarCall = multerCalls.find(
      (o) => o?.limits?.files === 1 && o?.limits?.fileSize === 5 * 1024 * 1024
    );
    const mediaCall = multerCalls.find(
      (o) => o?.limits?.files === 10 && o?.limits?.fileSize === 100 * 1024 * 1024
    );

    expect(avatarCall).toBeTruthy();
    expect(mediaCall).toBeTruthy();
    expect(memoryStorageMock).toHaveBeenCalledTimes(2); // avatar + media
    expect(diskStorageMock).not.toHaveBeenCalled();

    expect(mod.uploadAvatar).toEqual(expect.any(Function));
    expect(mod.uploadMedia).toEqual(expect.any(Function));
  });

  test('avatar/media uploaders use DISK storage when UPLOAD_TARGET=local', async () => {
    const mod = await reloadModule({ UPLOAD_TARGET: 'local', UPLOADS_DIR: '/tmp/u' });

    const { uploadDirs } = mod;

    const avatarCall = multerCalls.find(
      (o) => o?.limits?.files === 1 && o?.limits?.fileSize === 5 * 1024 * 1024
    );
    const mediaCall = multerCalls.find(
      (o) => o?.limits?.files === 10 && o?.limits?.fileSize === 100 * 1024 * 1024
    );

    expect(avatarCall).toBeTruthy();
    expect(mediaCall).toBeTruthy();
    expect(diskStorageMock).toHaveBeenCalledTimes(2);

    // Inspect disk storage options for avatar
    const avatarDiskOpts = diskStorageMock.mock.calls[0][0];
    expect(avatarDiskOpts).toHaveProperty('destination');
    expect(avatarDiskOpts).toHaveProperty('filename');

    // destination should resolve to AVATARS_DIR
    await new Promise((resolve) => {
      avatarDiskOpts.destination({}, {}, (err, dest) => {
        expect(err).toBeNull();
        expect(dest).toBe(uploadDirs.AVATARS_DIR);
        resolve();
      });
    });

    // filename should produce a sanitized name
    await new Promise((resolve) => {
      const file = { originalname: 'my weird name!!.PNG' };
      avatarDiskOpts.filename({}, file, (_err, outName) => {
        expect(typeof outName).toBe('string');
        expect(outName).toMatch(/my_weird_name__\.PNG$/); // base is sanitized; original case preserved
        resolve();
      });
    });
  });

  describe('fileFilter behavior', () => {
    const runFilter = (filter, mimetype, originalname) =>
      new Promise((resolve) => {
        const file = { mimetype, originalname };
        filter({}, file, (err, accept) => resolve([err, accept]));
      });

    test('avatar: accepts proper image types and extensions', async () => {
      await reloadModule({ UPLOAD_TARGET: 'memory' });

      const avatarCall = multerCalls.find(
        (o) => o?.limits?.files === 1 && o?.limits?.fileSize === 5 * 1024 * 1024
      );
      const filter = avatarCall.fileFilter;

      // Good JPEG
      let [err, accept] = await runFilter(filter, 'image/jpeg', 'pic.jpg');
      expect(err).toBeNull();
      expect(accept).toBe(true);

      // Image with unsupported extension (e.g., .svg)
      ;[err, accept] = await runFilter(filter, 'image/png', 'vector.svg');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('INVALID_IMAGE_EXTENSION');
      expect(accept).toBe(false);

      // Non-image blocked due to imagesOnly=true
      ;[err, accept] = await runFilter(filter, 'application/pdf', 'file.pdf');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('IMAGE_ONLY');
      expect(accept).toBe(false);
    });

    test('media: allows PDFs and rejects dangerous extensions', async () => {
      await reloadModule({});

      const mediaCall = multerCalls.find(
        (o) => o?.limits?.files === 10 && o?.limits?.fileSize === 100 * 1024 * 1024
      );
      const filter = mediaCall.fileFilter;

      // Allowed doc type
      let [err, accept] = await runFilter(filter, 'application/pdf', 'report.pdf');
      expect(err).toBeNull();
      expect(accept).toBe(true);

      // Disallowed extension even if MIME is allowed
      ;[err, accept] = await runFilter(filter, 'application/pdf', 'page.html');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('UNSUPPORTED_FILE_TYPE');
      expect(accept).toBe(false);
    });

    test('rejects unknown MIME types early', async () => {
      await reloadModule({});

      const mediaCall = multerCalls.find(
        (o) => o?.limits?.files === 10 && o?.limits?.fileSize === 100 * 1024 * 1024
      );
      const filter = mediaCall.fileFilter;

      const [err, accept] = await runFilter(filter, 'application/x-msdownload', 'a.exe');
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('UNSUPPORTED_FILE_TYPE');
      expect(accept).toBe(false);
    });
  });

  describe('sha256()', () => {
    test('returns correct hash for a buffer', async () => {
      const { sha256 } = await reloadModule({});
      const out = sha256(Buffer.from('hello'));
      // precomputed SHA-256 of "hello"
      expect(out).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });

  describe('buildSafeName()', () => {
    test('uses preferred extension for known MIME', async () => {
      const { buildSafeName } = await reloadModule({});
      const { ext, suggested } = buildSafeName('image/jpeg', 'My photo.PNG');
      expect(ext).toBe('jpg');
      expect(suggested.endsWith('.jpg')).toBe(true);
      // sanitized base (spaces -> underscores)
      expect(suggested).toMatch(/^My_photo/);
    });

    test('keeps safe original extension when MIME is unknown', async () => {
      const { buildSafeName } = await reloadModule({});
      const { ext, suggested } = buildSafeName('application/octet-stream', 'report.txt');
      expect(ext).toBe('txt');
      expect(suggested.endsWith('.txt')).toBe(true);
    });

    test('falls back to .bin when original extension is disallowed', async () => {
      const { buildSafeName } = await reloadModule({});
      const { ext, suggested } = buildSafeName('application/octet-stream', 'page.html');
      expect(ext).toBe('bin');
      expect(suggested.endsWith('.bin')).toBe(true);
    });

    test('sanitizes path-like and long names', async () => {
      const { buildSafeName } = await reloadModule({});
      const { suggested } = buildSafeName('application/pdf', '../weird/../../name with spaces.pdf');
      expect(suggested).toMatch(/name_with_spaces\.pdf$/);
      expect(suggested.length).toBeLessThanOrEqual(90); // 80 base + dot + ext
    });
  });

  test('uploadDirs exposes ROOT/AVATARS_DIR/MEDIA_DIR and TARGET', async () => {
    const mod = await reloadModule({ UPLOAD_TARGET: 'local', UPLOADS_DIR: '/data/u' });
    const { uploadDirs } = mod;
    expect(uploadDirs).toMatchObject({
      ROOT: '/data/u',
      AVATARS_DIR: '/data/u/avatars',
      MEDIA_DIR: '/data/u/media',
      TARGET: 'local',
    });
  });
});
