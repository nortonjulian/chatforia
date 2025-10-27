import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

function makeSharpMock() {
  // We'll capture call history in plain arrays we can assert on.
  const calls = {
    sharpCtor: [],
    rotate: 0,
    resize: [],
    jpeg: [],
    png: [],
    webp: [],
    toBuffer: [],
    metadata: [],
  };

  // chainable instance object that sharp(...) returns
  const chainObj = {
    rotate: jest.fn(function () {
      calls.rotate += 1;
      return this;
    }),
    resize: jest.fn(function (opts) {
      calls.resize.push(opts);
      return this;
    }),
    jpeg: jest.fn(function (opts) {
      calls.jpeg.push(opts);
      return this;
    }),
    png: jest.fn(function (opts) {
      calls.png.push(opts);
      return this;
    }),
    webp: jest.fn(function (opts) {
      calls.webp.push(opts);
      return this;
    }),
    toBuffer: jest.fn(async function (opts) {
      calls.toBuffer.push(opts);
      // mimic Sharp's { data, info } return when resolveWithObject: true
      return { data: Buffer.from('PROCESSED'), info: { dummy: true } };
    }),
    metadata: jest.fn(async function () {
      const fake = { width: 800, height: 600, format: 'jpeg' };
      calls.metadata.push(null);
      return fake;
    }),
  };

  // mock sharp() ctor itself
  const sharpFn = jest.fn((bufferArg, optsArg) => {
    calls.sharpCtor.push({ bufferArg, optsArg });
    return chainObj;
  });

  return { sharpFn, calls, chainObj };
}

async function loadImageModuleWithSharpMock() {
  jest.resetModules();

  const { sharpFn, calls } = makeSharpMock();

  jest.unstable_mockModule('sharp', () => ({
    default: sharpFn,
  }));

  const mod = await import('../../utils/image.js');

  return {
    mod,
    calls,
  };
}

describe('image utils', () => {
  test('processImage() default flow (format="original") chains sharp/rotate/resize and returns buffer data', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { processImage, DEFAULT_MAX_WIDTH } = mod;

    const inputBuf = Buffer.from('rawimage');

    const out = await processImage(inputBuf); // defaults: maxWidth=DEFAULT_MAX_WIDTH, format='original', quality=82

    // output should be the "data" from toBuffer mock
    expect(out.equals(Buffer.from('PROCESSED'))).toBe(true);

    // sharp() ctor call
    expect(calls.sharpCtor).toHaveLength(1);
    expect(calls.sharpCtor[0]).toEqual({
      bufferArg: inputBuf,
      optsArg: { failOn: 'none' },
    });

    // rotate() called once
    expect(calls.rotate).toBe(1);

    // resize() called once with correct opts
    expect(calls.resize).toHaveLength(1);
    expect(calls.resize[0]).toEqual({
      width: DEFAULT_MAX_WIDTH,
      withoutEnlargement: true,
    });

    // With format='original', we should NOT have called jpeg/png/webp encoders
    expect(calls.jpeg).toHaveLength(0);
    expect(calls.png).toHaveLength(0);
    expect(calls.webp).toHaveLength(0);

    // toBuffer called once with { resolveWithObject: true }
    expect(calls.toBuffer).toHaveLength(1);
    expect(calls.toBuffer[0]).toEqual({ resolveWithObject: true });
  });

  test('processImage() with format="jpeg" applies jpeg encoder with mozjpeg and given quality', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { processImage } = mod;

    const buf = Buffer.from('img');
    const out = await processImage(buf, {
      maxWidth: 1024,
      format: 'jpeg',
      quality: 90,
    });

    expect(out.equals(Buffer.from('PROCESSED'))).toBe(true);

    // resize() should have been called with width:1024
    expect(calls.resize[0]).toEqual({
      width: 1024,
      withoutEnlargement: true,
    });

    // jpeg() should have been called with quality and mozjpeg: true
    expect(calls.jpeg).toHaveLength(1);
    expect(calls.jpeg[0]).toEqual({ quality: 90, mozjpeg: true });

    // png() / webp() should not fire in this branch
    expect(calls.png).toHaveLength(0);
    expect(calls.webp).toHaveLength(0);
  });

  test('processImage() with format="png" calls .png({ compressionLevel:9 })', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { processImage } = mod;

    await processImage(Buffer.from('img2'), {
      maxWidth: 500,
      format: 'png',
    });

    // resize() width should be 500
    expect(calls.resize[0]).toEqual({
      width: 500,
      withoutEnlargement: true,
    });

    // png() called correctly
    expect(calls.png).toHaveLength(1);
    expect(calls.png[0]).toEqual({ compressionLevel: 9 });

    // jpeg()/webp() not called
    expect(calls.jpeg).toHaveLength(0);
    expect(calls.webp).toHaveLength(0);
  });

  test('processImage() with format="webp" calls .webp({ quality, effort:4 })', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { processImage } = mod;

    await processImage(Buffer.from('img3'), {
      maxWidth: 800,
      format: 'webp',
      quality: 77,
    });

    // resize width is 800
    expect(calls.resize[0]).toEqual({
      width: 800,
      withoutEnlargement: true,
    });

    // webp encoder called
    expect(calls.webp).toHaveLength(1);
    expect(calls.webp[0]).toEqual({ quality: 77, effort: 4 });

    // others not called
    expect(calls.jpeg).toHaveLength(0);
    expect(calls.png).toHaveLength(0);
  });

  test('thumbnail() defaults: size=DEFAULT_THUMB_SIZE, format="webp", quality=80, fit="inside"', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { thumbnail, DEFAULT_THUMB_SIZE } = mod;

    const buf = Buffer.from('rawthumb');

    const out = await thumbnail(buf); // defaults

    expect(out.equals(Buffer.from('PROCESSED'))).toBe(true);

    // ctor
    expect(calls.sharpCtor).toHaveLength(1);
    expect(calls.sharpCtor[0].bufferArg).toBe(buf);
    expect(calls.sharpCtor[0].optsArg).toEqual({ failOn: 'none' });

    // rotate called
    expect(calls.rotate).toBe(1);

    // resize called with square-ish config
    expect(calls.resize).toHaveLength(1);
    expect(calls.resize[0]).toEqual({
      width: DEFAULT_THUMB_SIZE,
      height: DEFAULT_THUMB_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    });

    // webp() encoder should run by default w/ { quality: 80, effort:4 }
    expect(calls.webp).toHaveLength(1);
    expect(calls.webp[0]).toEqual({ quality: 80, effort: 4 });

    // png/jpeg should not be called by default
    expect(calls.png).toHaveLength(0);
    expect(calls.jpeg).toHaveLength(0);

    // toBuffer called once
    expect(calls.toBuffer).toHaveLength(1);
    expect(calls.toBuffer[0]).toEqual({ resolveWithObject: true });
  });

  test('thumbnail() respects override format "jpeg" / "png" and custom size', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { thumbnail } = mod;

    await thumbnail(Buffer.from('imgthumb'), {
      size: 256,
      format: 'jpeg',
      quality: 65,
    });

    // Resize should have been called with width/height 256
    expect(calls.resize[0]).toEqual({
      width: 256,
      height: 256,
      fit: 'inside',
      withoutEnlargement: true,
    });

    // jpeg() should have been called with quality + mozjpeg:true
    expect(calls.jpeg).toHaveLength(1);
    expect(calls.jpeg[0]).toEqual({ quality: 65, mozjpeg: true });

    // webp()/png() should not run in this branch
    expect(calls.webp).toHaveLength(0);
    expect(calls.png).toHaveLength(0);
  });

  test('getMetadata() calls sharp(buffer).metadata() and returns that value', async () => {
    const { mod, calls } = await loadImageModuleWithSharpMock();
    const { getMetadata } = mod;

    const buf = Buffer.from('pic');
    const meta = await getMetadata(buf);

    // We should have called sharp() once
    expect(calls.sharpCtor).toHaveLength(1);
    expect(calls.sharpCtor[0]).toEqual({
      bufferArg: buf,
      optsArg: undefined, // getMetadata uses sharp(buffer) with no options
    });

    // metadata() should have been invoked once
    expect(calls.metadata).toHaveLength(1);

    // getMetadata should return whatever metadata() resolved
    expect(meta).toEqual({ width: 800, height: 600, format: 'jpeg' });
  });
});
