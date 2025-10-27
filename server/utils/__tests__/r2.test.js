import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => { 
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

// We'll set up a helper that:
// 1. sets env vars
// 2. mocks AWS SDK modules
// 3. imports ../../utils/r2.js
async function loadR2Module(opts = {}) {
  jest.resetModules();

  const {
    accessKeyId,
    secretAccessKey,
    endpointHost,
    bucket,
    publicBase,
  } = {
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'SECRET_TEST',
    endpointHost: 'abc123.r2.cloudflarestorage.com',
    bucket: 'chatforia-prod',
    publicBase: 'https://media.chatforia.com',
    ...opts,
  };

  process.env.R2_ACCESS_KEY_ID = accessKeyId;
  process.env.R2_SECRET_ACCESS_KEY = secretAccessKey;
  process.env.R2_S3_ENDPOINT = endpointHost;
  process.env.R2_BUCKET = bucket;

  // Only set R2_PUBLIC_BASE if caller explicitly provided something
  // other than undefined. If they passed undefined, we DELETE it.
  if (opts.hasOwnProperty('publicBase')) {
    if (publicBase === undefined) {
      delete process.env.R2_PUBLIC_BASE;
    } else {
      process.env.R2_PUBLIC_BASE = publicBase;
    }
  } else {
    // caller didn't mention publicBase, use resolved default
    process.env.R2_PUBLIC_BASE = publicBase;
  }

  // We'll capture ctor args for S3Client and for commands.
  const s3ClientSendMock = jest.fn(async (cmd) => {
    // mimic AWS SDK .send() returning response
    return { ok: true, sent: cmd };
  });

  const s3ClientCtorArgs = [];
  const mockS3Client = class MockS3Client {
    constructor(opts) {
      s3ClientCtorArgs.push(opts);
      this.send = s3ClientSendMock;
    }
  };

  const putObjectCtorArgs = [];
  class MockPutObjectCommand {
    constructor(params) {
      putObjectCtorArgs.push(params);
      this.params = params;
    }
  }

  const getObjectCtorArgs = [];
  class MockGetObjectCommand {
    constructor(params) {
      getObjectCtorArgs.push(params);
      this.params = params;
    }
  }

  const getSignedUrlMock = jest.fn(async (_client, cmd, opts) => {
    return `https://signed.example/${cmd.params?.Key || 'unknown'}?exp=${opts.expiresIn}`;
  });

  jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
    S3Client: mockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
  }));

  jest.unstable_mockModule('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: getSignedUrlMock,
  }));

  const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

  const mod = await import('../../utils/r2.js');

  return {
    mod,
    s3ClientSendMock,
    s3ClientCtorArgs,
    putObjectCtorArgs,
    getObjectCtorArgs,
    getSignedUrlMock,
    consoleWarnSpy,
  };
}

describe('r2.js', () => {
  test('constructs S3Client with correct endpoint, creds, and forcePathStyle, and warns when env missing', async () => {
    // --- Case 1: all env provided ---
    const {
      s3ClientCtorArgs,
      consoleWarnSpy,
    } = await loadR2Module({
      accessKeyId: 'KEY123',
      secretAccessKey: 'SECRET456',
      endpointHost: 'acctid.r2.cloudflarestorage.com',
      bucket: 'cf-bucket',
      publicBase: 'https://cdn.example.com',
    });

    // S3Client constructor should have been called exactly once
    expect(s3ClientCtorArgs).toHaveLength(1);
    const opts = s3ClientCtorArgs[0];

    expect(opts).toEqual({
      region: 'auto',
      endpoint: 'https://acctid.r2.cloudflarestorage.com',
      forcePathStyle: true,
      credentials: {
        accessKeyId: 'KEY123',
        secretAccessKey: 'SECRET456',
      },
    });

    // With complete env, no warnings about missing vars
    expect(consoleWarnSpy).not.toHaveBeenCalled();

    // --- Case 2: missing env triggers warnings ---
    jest.resetModules();
    jest.restoreAllMocks();

    const consoleWarnSpy2 = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    process.env = { ...ORIGINAL_ENV };

    await loadR2Module({
      accessKeyId: '',            // missing
      secretAccessKey: '',        // missing
      endpointHost: '',           // missing
      bucket: '',                 // missing
      publicBase: 'https://does-not-matter.test', // doesn't affect warnings
    });

    // We expect at least two warnings:
    // - Missing core creds/endpoint
    // - Missing bucket
    const warnMsgs = consoleWarnSpy2.mock.calls.map(([msg]) => msg);
    expect(
      warnMsgs.some((m) =>
        /\[R2] Missing env vars/i.test(m)
      )
    ).toBe(true);
    expect(
      warnMsgs.some((m) =>
        /\[R2] Missing env var R2_BUCKET/i.test(m)
      )
    ).toBe(true);
  });

  test('r2PutObject issues PutObjectCommand with all metadata and calls r2.send', async () => {
    const {
      mod,
      s3ClientSendMock,
      putObjectCtorArgs,
    } = await loadR2Module({
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      endpointHost: 'acc.r2.example',
      bucket: 'chatforia-prod',
      publicBase: 'https://media.chatforia.com',
    });

    const { r2PutObject } = mod;

    const bodyBuf = Buffer.from('hi file');
    const res = await r2PutObject({
      key: 'avatars/user123.jpg',
      body: bodyBuf,
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
      contentDisposition: 'inline',
      acl: 'public-read',
    });

    // r2.send called exactly once
    expect(s3ClientSendMock).toHaveBeenCalledTimes(1);

    // The PutObjectCommand ctor should have captured params passed in
    expect(putObjectCtorArgs).toHaveLength(1);
    expect(putObjectCtorArgs[0]).toEqual({
      Bucket: 'chatforia-prod',
      Key: 'avatars/user123.jpg',
      Body: bodyBuf,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
      ContentDisposition: 'inline',
      ACL: 'public-read',
    });

    // r2PutObject should resolve to whatever r2.send resolved
    expect(res).toEqual({
      ok: true,
      sent: expect.objectContaining({
        params: expect.objectContaining({
          Key: 'avatars/user123.jpg',
        }),
      }),
    });
  });

  test('r2PresignGet builds GetObjectCommand and calls getSignedUrl with expiresSec and response headers', async () => {
    const {
      mod,
      getObjectCtorArgs,
      getSignedUrlMock,
    } = await loadR2Module({
      endpointHost: 'cloudflare.r2',
      bucket: 'cf-bucket',
    });

    const { r2PresignGet } = mod;

    const url = await r2PresignGet({
      key: 'media/file.png',
      expiresSec: 123,
      responseContentType: 'image/png',
      responseDisposition: 'inline; filename="file.png"',
    });

    expect(getObjectCtorArgs).toHaveLength(1);
    expect(getObjectCtorArgs[0]).toEqual({
      Bucket: 'cf-bucket',
      Key: 'media/file.png',
      ResponseContentType: 'image/png',
      ResponseContentDisposition: 'inline; filename="file.png"',
    });

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, cmdArg, optsArg] = getSignedUrlMock.mock.calls[0];
    expect(optsArg).toEqual({ expiresIn: 123 });

    expect(url).toMatch(
      /^https:\/\/signed\.example\/media\/file\.png\?exp=123$/
    );
  });

  test('r2PresignPut builds PutObjectCommand and calls getSignedUrl with expiresSec and headers', async () => {
    const {
      mod,
      putObjectCtorArgs,
      getSignedUrlMock,
    } = await loadR2Module({
      endpointHost: 'cloudflare.r2',
      bucket: 'cf-bucket',
    });

    const { r2PresignPut } = mod;

    const signed = await r2PresignPut({
      key: 'uploads/user123/avatar.jpg',
      contentType: 'image/jpeg',
      expiresSec: 777,
      cacheControl: 'public, max-age=3600',
      contentDisposition: 'inline; filename="avatar.jpg"',
    });

    const lastArgs = putObjectCtorArgs[putObjectCtorArgs.length - 1];
    expect(lastArgs).toEqual({
      Bucket: 'cf-bucket',
      Key: 'uploads/user123/avatar.jpg',
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=3600',
      ContentDisposition: 'inline; filename="avatar.jpg"',
    });

    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, cmdArg, optsArg] = getSignedUrlMock.mock.calls[0];
    expect(optsArg).toEqual({ expiresIn: 777 });

    expect(signed).toMatch(
      /^https:\/\/signed\.example\/uploads\/user123\/avatar\.jpg\?exp=777$/
    );
  });

  test('r2PublicUrl() returns null if R2_PUBLIC_BASE is unset; otherwise joins base + key with no double slashes', async () => {
    // Case 1: public base defined
    const { mod } = await loadR2Module({
      publicBase: 'https://cdn.example.com/',
    });

    const { r2PublicUrl } = mod;

    expect(r2PublicUrl('avatars/user123.jpg')).toBe(
      'https://cdn.example.com/avatars/user123.jpg'
    );
    expect(r2PublicUrl('/avatars/user123.jpg')).toBe(
      'https://cdn.example.com/avatars/user123.jpg'
    );

    // Case 2: no R2_PUBLIC_BASE in env at all
    jest.resetModules();
    jest.restoreAllMocks();

    const consoleWarnSpy3 = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    process.env = { ...ORIGINAL_ENV };

    // Explicitly request "unset" by passing { publicBase: undefined }
    const { mod: mod2 } = await loadR2Module({
      publicBase: undefined,
    });

    const { r2PublicUrl: r2PublicUrl2 } = mod2;
    expect(r2PublicUrl2('avatars/user123.jpg')).toBeNull();

    consoleWarnSpy3.mockRestore();
  });
});
