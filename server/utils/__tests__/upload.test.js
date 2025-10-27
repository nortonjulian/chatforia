import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';

// We'll control env + crypto randomness before importing upload.js,
// since upload.js reads env and defines functions using crypto.randomBytes.

// Save originals so we can restore later.
const ORIGINAL_ENV = { ...process.env };

afterEach(async () => {
  // restore env for the next test
  process.env = { ...ORIGINAL_ENV };

  // clear the ESM module cache so next test's dynamic import sees fresh env/mocks
  jest.resetModules();
});

describe('upload.js core helpers', () => {
  test('ensureUploadDir, saveBuffer, saveStream, deleteFile, etc. work in an isolated UPLOAD_ROOT', async () => {
    // 1. Set up a temp root for uploads, and mock randomBytes to be predictable.
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'chatforia-uploadtest-'));
    process.env.UPLOAD_DIR = tmpRoot;

    // We'll stub crypto.randomBytes to always return the same hex "abc123abc123".
    jest.resetModules();
    jest.unstable_mockModule('node:crypto', () => ({
      default: {
        randomBytes: () => Buffer.from('abc123abc123', 'utf8'),
      },
      randomBytes: () => Buffer.from('abc123abc123', 'utf8'),
    }));

    // 2. Now import the module under test fresh with the env + mock in place.
    const uploadMod = await import('../../utils/upload.js');

    const {
      UPLOAD_ROOT,
      uploadDirs,
      ensureUploadDir,
      makeSafeFilename,
      diskPathFor,
      getPublicUrl,
      saveBuffer,
      saveStream,
      deleteFile,
      __resetUploads,
      makeUploader,
    } = uploadMod;

    // Sanity: UPLOAD_ROOT should equal our temp dir
    expect(UPLOAD_ROOT).toBe(tmpRoot);
    expect(uploadDirs.ROOT).toBe(tmpRoot);
    expect(uploadDirs.AVATARS_DIR).toBe(path.join(tmpRoot, 'avatars'));
    expect(uploadDirs.MEDIA_DIR).toBe(path.join(tmpRoot, 'media'));

    // --- ensureUploadDir ---
    const avatarsDir = await ensureUploadDir('avatars');
    expect(avatarsDir).toBe(path.join(tmpRoot, 'avatars'));
    const avatarsStat = await fsp.stat(avatarsDir);
    expect(avatarsStat.isDirectory()).toBe(true);

    // --- makeSafeFilename ---
    expect(makeSafeFilename('My Cute Pic!!.png')).toMatch(/^My_Cute_Pic__\.png$/);
    const fallbackName = makeSafeFilename('');
    expect(fallbackName.startsWith('file_')).toBe(true); // timestamp-based fallback

    // --- diskPathFor ---
    const expectedDiskPath = path.resolve(tmpRoot, 'avatars/foo.jpg');
    expect(diskPathFor('avatars/foo.jpg')).toBe(expectedDiskPath);

    // --- getPublicUrl ---
    expect(getPublicUrl('avatars/foo.jpg')).toBe('/uploads/avatars/foo.jpg');
    expect(getPublicUrl('.\\avatars\\bar.jpg')).toBe('/uploads/avatars/bar.jpg');

    // --- saveBuffer ---
    const buf = Buffer.from('hello buffer');
    const resultBufSave = await saveBuffer(buf, {
      filename: 'test image!!.jpg',
      subdir: 'media',
    });

    expect(resultBufSave.relativePath).toMatch(
      /^media\/test_image__-abc123abc123\.jpg$/
    );
    expect(resultBufSave.absolutePath).toBe(
      path.join(tmpRoot, 'media', `test_image__-abc123abc123.jpg`)
    );
    expect(resultBufSave.url).toBe(
      `/uploads/media/test_image__-abc123abc123.jpg`
    );

    const diskContent = await fsp.readFile(resultBufSave.absolutePath, 'utf8');
    expect(diskContent).toBe('hello buffer');
    expect(resultBufSave.size).toBe(Buffer.byteLength('hello buffer'));

    // --- saveStream ---
    const streamData = 'stream says hi';
    const readable = Readable.from(streamData);
    const resultStreamSave = await saveStream(readable, {
      filename: 'avatar!!.png',
      subdir: 'avatars',
    });

    expect(resultStreamSave.relativePath).toMatch(
      /^avatars\/avatar__-abc123abc123\.png$/
    );
    expect(resultStreamSave.absolutePath).toBe(
      path.join(tmpRoot, 'avatars', `avatar__-abc123abc123.png`)
    );
    expect(resultStreamSave.url).toBe(
      `/uploads/avatars/avatar__-abc123abc123.png`
    );

    const diskContent2 = await fsp.readFile(resultStreamSave.absolutePath, 'utf8');
    expect(diskContent2).toBe(streamData);

    // --- deleteFile ---
    await deleteFile(resultBufSave.relativePath); // should remove without throwing
    await expect(fsp.stat(resultBufSave.absolutePath)).rejects.toThrow();
    await expect(deleteFile(resultBufSave.relativePath)).resolves.toBeUndefined();

    // make sure stream file is still there
    const stillThere = await fsp.readFile(resultStreamSave.absolutePath, 'utf8');
    expect(stillThere).toBe(streamData);

    // --- __resetUploads ---
    await __resetUploads();
    const rootStat = await fsp.stat(tmpRoot);
    expect(rootStat.isDirectory()).toBe(true);
    await expect(fsp.stat(resultStreamSave.absolutePath)).rejects.toThrow();

    // --- makeUploader factory ---
    const up = makeUploader({
      kind: 'avatar',
      maxBytes: 12345,
      maxFiles: 2,
      rootDir: tmpRoot,
      urlPrefix: '/cdn/files',
    });

    expect(up.limits).toEqual({ fileSize: 12345, files: 2 });
    expect(up.rootDir).toBe(tmpRoot);
    expect(up.urlPrefix).toBe('/cdn/files');

    // ensureDir should create nested dirs under avatars/
    const specialDir = await up.ensureDir('subsub');
    expect(specialDir).toBe(path.resolve(tmpRoot, 'avatars', 'subsub'));
    const specialDirStat = await fsp.stat(specialDir);
    expect(specialDirStat.isDirectory()).toBe(true);

    // safeName
    expect(up.safeName('bad name!! lol?.txt')).toBe('bad_name__lol_.txt');
    expect(up.safeName('')).toMatch(/^file_\d+$/);

    // scoped saveBuffer should write to avatars/subsub/... and build /cdn/files/... URL
    const buf2 = Buffer.from('avatar buf');
    const scopedRes = await up.saveBuffer(buf2, {
      filename: ' cool avatar!!.gif',
      subdir: 'subsub',
    });

    expect(scopedRes.relativePath).toBe(
      'avatars/subsub/cool_avatar__-abc123abc123.gif'
    );

    const fileExists = await fsp.readFile(scopedRes.absolutePath, 'utf8');
    expect(fileExists).toBe('avatar buf');

    expect(scopedRes.url).toBe(
      '/cdn/files/avatars/subsub/cool_avatar__-abc123abc123.gif'
    );

    // deleteFile via uploader
    await up.deleteFile(scopedRes.relativePath);
    await expect(fsp.stat(scopedRes.absolutePath)).rejects.toThrow();
    await expect(up.deleteFile(scopedRes.relativePath)).resolves.toBeUndefined();
  });
});
