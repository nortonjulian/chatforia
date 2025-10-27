import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

// helper: create sandbox upload root per test, mock deps, then import module
async function loadThumbnailerWithRoot(tmpRootDir) {
  jest.resetModules();

  // IMPORTANT: mock the exact specifier used in thumbnailer.js:
  // thumbnailer.js imports '../middleware/uploads.js'
  jest.unstable_mockModule('../middleware/uploads.js', () => ({
    uploadDirs: {
      ROOT: tmpRootDir,
    },
  }));

  // ---- we'll mock sharp and capture the pipeline chain calls ----
  const sharpCalls = [];
  const mockSharpObj = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockImplementation((w, h, opts) => {
      sharpCalls.push({ op: 'resize', w, h, opts });
      return mockSharpObj;
    }),
    jpeg: jest.fn().mockImplementation((opts) => {
      sharpCalls.push({ op: 'jpeg', opts });
      return mockSharpObj;
    }),
    toFile: jest.fn(async (destPath) => {
      sharpCalls.push({ op: 'toFile', destPath });
      // "write" the file so fs.promises.access passes later
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.writeFile(destPath, 'fake-thumb');
    }),
  };

  const sharpMockFn = jest.fn((absSourceArg) => {
    sharpCalls.push({ op: 'sharp', absSourceArg });
    return mockSharpObj;
  });

  jest.unstable_mockModule('sharp', () => ({
    default: sharpMockFn,
  }));

  // import the module under test AFTER mocks
  const mod = await import('../../utils/thumbnailer.js');

  return { mod, sharpCalls, sharpMockFn, mockSharpObj };
}

afterEach(async () => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe('thumbnailer.ensureThumb()', () => {
  test('generates thumbnail if missing, then reuses cached file on second call', async () => {
    // 1. create sandbox upload root dir
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'chatforia-thumbtest-')
    );

    const { mod, sharpCalls, sharpMockFn, mockSharpObj } =
      await loadThumbnailerWithRoot(tmpRoot);

    const { ensureThumb } = mod;

    // Pretend we have an original image at tmpRoot/media/original.jpg
    const absSource = path.join(tmpRoot, 'media', 'original.jpg');
    await fsp.mkdir(path.dirname(absSource), { recursive: true });
    await fsp.writeFile(absSource, 'fake-image-data');

    const relName = 'user123/avatar-abc';

    // ---- First call: thumbnail doesn't exist yet ----
    const first = await ensureThumb(absSource, relName);

    // THUMBS_DIR should be <tmpRoot>/thumbs
    const expectedThumbAbs = path.join(
      tmpRoot,
      'thumbs',
      relName + '.thumb.jpg'
    );
    const expectedRel = path.join('thumbs', relName + '.thumb.jpg');

    // returns correct structure
    expect(first).toEqual({
      rel: expectedRel,
      abs: expectedThumbAbs,
    });

    // file should exist on disk now (mockSharp wrote "fake-thumb")
    const writtenData = await fsp.readFile(expectedThumbAbs, 'utf8');
    expect(writtenData).toBe('fake-thumb');

    // sharp should have been used exactly once
    expect(sharpMockFn).toHaveBeenCalledTimes(1);
    expect(sharpMockFn).toHaveBeenCalledWith(absSource);

    // Check recorded ops
    const resizeCall = sharpCalls.find((c) => c.op === 'resize');
    expect(resizeCall).toEqual({
      op: 'resize',
      w: 512,
      h: 512,
      opts: { fit: 'inside' },
    });

    const jpegCall = sharpCalls.find((c) => c.op === 'jpeg');
    expect(jpegCall).toEqual({
      op: 'jpeg',
      opts: { quality: 76 },
    });

    const toFileCall = sharpCalls.find((c) => c.op === 'toFile');
    expect(toFileCall.destPath).toBe(expectedThumbAbs);

    // ---- Second call: thumbnail already exists, should short-circuit ----
    sharpMockFn.mockClear();
    mockSharpObj.rotate.mockClear();
    mockSharpObj.resize.mockClear();
    mockSharpObj.jpeg.mockClear();
    mockSharpObj.toFile.mockClear();

    const second = await ensureThumb(absSource, relName);
    expect(second).toEqual({
      rel: expectedRel,
      abs: expectedThumbAbs,
    });

    // No new sharp calls this time because it should hit the fs.promises.access fast path
    expect(sharpMockFn).not.toHaveBeenCalled();
    expect(mockSharpObj.toFile).not.toHaveBeenCalled();
  });
});
