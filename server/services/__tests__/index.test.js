import { jest } from '@jest/globals';

const ORIGINAL_ENV = process.env;

// ---- Mock node:fs/promises ----
const fsMock = {
  mkdir: jest.fn(() => Promise.resolve()),
  writeFile: jest.fn(() => Promise.resolve()),
};

jest.unstable_mockModule('node:fs/promises', () => ({
  __esModule: true,
  default: fsMock,
}));

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Clear calls but keep the Promise-returning implementation
  fsMock.mkdir.mockClear();
  fsMock.writeFile.mockClear();

  // Re-import the real local storage adapter
  return import('../storage/localStorage.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('storage local adapter (localStorage.js)', () => {
  const UPLOAD_ROOT = '/fake/uploads/root';

  test('boot-time: creates UPLOAD_ROOT (mkdir recursive)', async () => {
    await reload({ UPLOAD_ROOT });

    // top-level await fs.mkdir(UPLOAD_ROOT, { recursive: true })
    expect(fsMock.mkdir).toHaveBeenCalledWith(UPLOAD_ROOT, { recursive: true });
  });

  test('storeBuffer: writes with wx flag and returns location; ignores EEXIST', async () => {
    const mod = await reload({ UPLOAD_ROOT });

    const buf = Buffer.from('hello');

    // First call: success (writeFile resolves)
    const out1 = await mod.storeBuffer({ buf, key: 'media/abc.bin' });

    // mkdir called for parent dir of the file
    expect(fsMock.mkdir).toHaveBeenCalledWith(
      `${UPLOAD_ROOT}/media`,
      { recursive: true }
    );

    // writeFile called with wx flag
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      `${UPLOAD_ROOT}/media/abc.bin`,
      buf,
      { flag: 'wx' }
    );
    expect(out1).toEqual({ ok: true, location: `${UPLOAD_ROOT}/media/abc.bin` });

    // Second call: EEXIST should be swallowed, still resolves ok
    fsMock.writeFile.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'EEXIST' })
    );

    await expect(
      mod.storeBuffer({ buf, key: 'media/abc.bin' })
    ).resolves.toEqual({ ok: true, location: `${UPLOAD_ROOT}/media/abc.bin` });

    // Third call: other errors should propagate
    fsMock.writeFile.mockRejectedValueOnce(
      Object.assign(new Error('disk fail'), { code: 'EIO' })
    );

    await expect(
      mod.storeBuffer({ buf, key: 'media/abc.bin' })
    ).rejects.toThrow('disk fail');
  });

  test('keyToAbsolute: joins UPLOAD_ROOT and key', async () => {
    const mod = await reload({ UPLOAD_ROOT });

    const abs = mod.keyToAbsolute('avatars/u1.png');
    expect(abs).toBe(`${UPLOAD_ROOT}/avatars/u1.png`);
  });

  test('readStream: returns ok:true and defers to caller', async () => {
    const mod = await reload({ UPLOAD_ROOT });

    const createReadStream = jest.fn();
    const result = await mod.readStream({ key: 'media/video.mp4', createReadStream });

    expect(result).toEqual({ ok: true });
    // localStorage.js intentionally doesn’t call createReadStream itself
    expect(createReadStream).not.toHaveBeenCalled();
  });
});
