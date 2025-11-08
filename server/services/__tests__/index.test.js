const ORIGINAL_ENV = process.env;

// ---- Mock fs (ESM default import) ----
let fsMock;
jest.mock('fs', () => {
  const promises = {
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
  };
  fsMock = {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    promises,
    createReadStream: jest.fn(),
  };
  return { __esModule: true, default: fsMock };
});

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Clear any cached copy so the top-level boot logic re-runs
  return import('../index.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('storage local adapter', () => {
  const UPLOAD_ROOT = '/fake/uploads/root';

  test('boot-time: creates UPLOAD_ROOT if missing', async () => {
    // existsSync -> false triggers mkdirSync
    fsMock.existsSync.mockReturnValue(false);

    await reload({ UPLOAD_ROOT });

    expect(fsMock.existsSync).toHaveBeenCalledWith(UPLOAD_ROOT);
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(UPLOAD_ROOT, { recursive: true });
  });

  test('boot-time: does not create if already exists', async () => {
    fsMock.existsSync.mockReturnValue(true);

    await reload({ UPLOAD_ROOT });

    expect(fsMock.existsSync).toHaveBeenCalledWith(UPLOAD_ROOT);
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
  });

  test('storeBuffer: writes with wx flag and returns location; ignores EEXIST', async () => {
    fsMock.existsSync.mockReturnValue(true); // skip boot mkdir
    const mod = await reload({ UPLOAD_ROOT });

    const buf = Buffer.from('hello');
    // First call: success
    fsMock.promises.writeFile.mockResolvedValueOnce(undefined);
    fsMock.promises.mkdir.mockResolvedValue(undefined);

    const out1 = await mod.storeBuffer({ buf, key: 'media/abc.bin' });
    expect(fsMock.promises.mkdir).toHaveBeenCalledWith(`${UPLOAD_ROOT}/media`, { recursive: true });
    expect(fsMock.promises.writeFile).toHaveBeenCalledWith(
      `${UPLOAD_ROOT}/media/abc.bin`,
      buf,
      { flag: 'wx' }
    );
    expect(out1).toEqual({ ok: true, location: `${UPLOAD_ROOT}/media/abc.bin` });

    // Second call: EEXIST should be swallowed
    fsMock.promises.writeFile.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'EEXIST' }));
    await expect(
      mod.storeBuffer({ buf, key: 'media/abc.bin' })
    ).resolves.toEqual({ ok: true, location: `${UPLOAD_ROOT}/media/abc.bin` });

    // Third call: other errors should propagate
    fsMock.promises.writeFile.mockRejectedValueOnce(Object.assign(new Error('disk fail'), { code: 'EIO' }));
    await expect(
      mod.storeBuffer({ buf, key: 'media/abc.bin' })
    ).rejects.toThrow('disk fail');
  });

  test('saveFile: writes file and returns filepath', async () => {
    fsMock.existsSync.mockReturnValue(true);
    const mod = await reload({ UPLOAD_ROOT });

    fsMock.promises.mkdir.mockResolvedValue(undefined);
    fsMock.promises.writeFile.mockResolvedValue(undefined);

    const out = await mod.saveFile(Buffer.from('x'), 'avatars/u1.png');
    expect(fsMock.promises.mkdir).toHaveBeenCalledWith(`${UPLOAD_ROOT}/avatars`, { recursive: true });
    expect(fsMock.promises.writeFile).toHaveBeenCalledWith(
      `${UPLOAD_ROOT}/avatars/u1.png`,
      expect.any(Buffer)
    );
    expect(out).toBe(`${UPLOAD_ROOT}/avatars/u1.png`);
  });

  test('getFileStream: returns read stream from joined path', async () => {
    fsMock.existsSync.mockReturnValue(true);
    const mod = await reload({ UPLOAD_ROOT });

    const fakeStream = { _tag: 'stream' };
    fsMock.createReadStream.mockReturnValue(fakeStream);

    const s = mod.getFileStream('media/video.mp4');
    expect(fsMock.createReadStream).toHaveBeenCalledWith(`${UPLOAD_ROOT}/media/video.mp4`);
    expect(s).toBe(fakeStream);
  });

  test('deleteFile: unlinks file and swallows errors', async () => {
    fsMock.existsSync.mockReturnValue(true);
    const mod = await reload({ UPLOAD_ROOT });

    // success path
    fsMock.promises.unlink.mockResolvedValueOnce(undefined);
    await expect(mod.deleteFile('old/file.bin')).resolves.toBeUndefined();
    expect(fsMock.promises.unlink).toHaveBeenCalledWith(`${UPLOAD_ROOT}/old/file.bin`);

    // error is swallowed
    fsMock.promises.unlink.mockRejectedValueOnce(new Error('missing'));
    await expect(mod.deleteFile('missing.bin')).resolves.toBeUndefined();
  });
});
