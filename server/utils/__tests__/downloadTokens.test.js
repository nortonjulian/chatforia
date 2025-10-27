import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.resetModules();
  jest.restoreAllMocks();
});

/**
 * Helper: load the module under test with a mocked jsonwebtoken.
 * We let the caller provide custom impls for sign() and verify().
 */
async function loadModuleWithJWTMock({ signImpl, verifyImpl, env = {} } = {}) {
  jest.resetModules();

  // control env: start from ORIGINAL_ENV, then apply overrides from `env`
  process.env = { ...ORIGINAL_ENV, ...env };

  const signMock = jest.fn(
    signImpl ||
      (() => 'signed.jwt.token') // default fake token string
  );

  const verifyMock = jest.fn(
    verifyImpl ||
      (() => ({
        p: 'avatars/123.jpg',
        o: 42,
        u: 'file',
        aud: 'download',
        iss: 'chatforia',
      }))
  );

  jest.unstable_mockModule('jsonwebtoken', () => ({
    default: { sign: signMock, verify: verifyMock },
    sign: signMock,
    verify: verifyMock,
  }));

  const mod = await import('../../utils/downloadTokens.js');
  return { mod, signMock, verifyMock };
}

describe('signDownloadToken', () => {
  test('signs with FILE_TOKEN_SECRET when present, includes all expected claims, and respects ttlSec', async () => {
    const { mod, signMock } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'super-secret',
        NODE_ENV: 'production',
      },
    });
    const { signDownloadToken } = mod;

    const token = signDownloadToken({
      path: 'media/room42/img.png',
      ownerId: 7,
      purpose: 'avatar',
      ttlSec: 300, // within [30,3600]
      audience: 'download',
      issuer: 'chatforia',
    });

    expect(token).toBe('signed.jwt.token');

    expect(signMock).toHaveBeenCalledTimes(1);
    const [payload, secret, opts] = signMock.mock.calls[0];

    expect(payload).toEqual({
      p: 'media/room42/img.png',
      o: 7,
      u: 'avatar',
      aud: 'download',
      iss: 'chatforia',
    });

    expect(secret).toBe('super-secret');

    expect(opts).toEqual({ expiresIn: 300 });
  });

  test('clamps ttlSec below MIN_TTL (30s) up to 30', async () => {
    const { mod, signMock } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'key',
        NODE_ENV: 'production',
      },
    });
    const { signDownloadToken } = mod;

    signDownloadToken({
      path: 'avatars/x.png',
      ownerId: 1,
      ttlSec: 5, // too low
    });

    const [_payload, _secret, opts] = signMock.mock.calls[0];
    expect(opts).toEqual({ expiresIn: 30 }); // clamped up
  });

  test('clamps ttlSec above MAX_TTL (3600s) down to 3600', async () => {
    const { mod, signMock } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'key',
        NODE_ENV: 'production',
      },
    });
    const { signDownloadToken } = mod;

    signDownloadToken({
      path: 'avatars/x.png',
      ownerId: 1,
      ttlSec: 999999, // too high
    });

    const [_payload, _secret, opts] = signMock.mock.calls[0];
    expect(opts).toEqual({ expiresIn: 3600 }); // clamped down
  });

  test('uses "test-secret" if FILE_TOKEN_SECRET is missing but NODE_ENV==="test"', async () => {
    const { mod, signMock } = await loadModuleWithJWTMock({
      env: {
        NODE_ENV: 'test',
        FILE_TOKEN_SECRET: '', // force "missing"
      },
    });
    const { signDownloadToken } = mod;

    signDownloadToken({
      path: 'avatars/test.png',
      ownerId: 99,
    });

    const [_payload, secret, _opts] = signMock.mock.calls[0];
    expect(secret).toBe('test-secret');
  });

  test('throws if FILE_TOKEN_SECRET missing and not in test env', async () => {
    const { mod } = await loadModuleWithJWTMock({
      env: {
        NODE_ENV: 'production',
        FILE_TOKEN_SECRET: '', // force "missing"
      },
    });
    const { signDownloadToken } = mod;

    expect(() => {
      signDownloadToken({
        path: 'avatars/bad.png',
        ownerId: 12,
      });
    }).toThrow('FILE_TOKEN_SECRET is required for signed download URLs');
  });
});

describe('verifyDownloadToken', () => {
  test('verifies token using correct secret, audience, and issuer, and returns normalized payload', async () => {
    const { mod, verifyMock } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'topsecret',
        NODE_ENV: 'production',
      },
      verifyImpl: jest.fn(() => ({
        p: 'media/abc.png',
        o: 55,
        u: 'avatar',
        aud: 'download',
        iss: 'chatforia',
      })),
    });

    const { verifyDownloadToken } = mod;

    const out = verifyDownloadToken('xyz.jwt.token', {
      audience: 'download',
      issuer: 'chatforia',
    });

    expect(out).toEqual({
      path: 'media/abc.png',
      ownerId: 55,
      purpose: 'avatar',
    });

    expect(verifyMock).toHaveBeenCalledTimes(1);
    const [tokenArg, secretArg, optsArg] = verifyMock.mock.calls[0];
    expect(tokenArg).toBe('xyz.jwt.token');
    expect(secretArg).toBe('topsecret');
    expect(optsArg).toEqual({
      audience: 'download',
      issuer: 'chatforia',
    });
  });

  test('defaults purpose to "file" and ownerId to null if not in payload', async () => {
    const { mod } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'abc123',
        NODE_ENV: 'production',
      },
      verifyImpl: jest.fn(() => ({
        p: 'avatars/someone.jpg',
        // o missing
        // u missing
        aud: 'download',
        iss: 'chatforia',
      })),
    });

    const { verifyDownloadToken } = mod;

    const out = verifyDownloadToken('tok');
    expect(out).toEqual({
      path: 'avatars/someone.jpg',
      ownerId: null,
      purpose: 'file',
    });
  });

  test('throws if payload is missing or does not have valid path string', async () => {
    // Case 1: payload is null/undefined
    const { mod: mod1 } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'abc123',
        NODE_ENV: 'production',
      },
      verifyImpl: jest.fn(() => null),
    });

    const { verifyDownloadToken: verifyDownloadToken1 } = mod1;
    expect(() => {
      verifyDownloadToken1('tok');
    }).toThrow('Invalid token payload');

    // Case 2: payload.p is not a string
    const { mod: mod2 } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'abc123',
        NODE_ENV: 'production',
      },
      verifyImpl: jest.fn(() => ({
        p: 12345, // not string
        aud: 'download',
        iss: 'chatforia',
      })),
    });

    const { verifyDownloadToken: verifyDownloadToken2 } = mod2;
    expect(() => {
      verifyDownloadToken2('tok');
    }).toThrow('Invalid token payload');
  });

  test('rejects any path with ".." to block traversal', async () => {
    const { mod } = await loadModuleWithJWTMock({
      env: {
        FILE_TOKEN_SECRET: 'abc123',
        NODE_ENV: 'production',
      },
      verifyImpl: jest.fn(() => ({
        p: '../etc/passwd',
        o: 1,
        u: 'file',
        aud: 'download',
        iss: 'chatforia',
      })),
    });

    const { verifyDownloadToken } = mod;
    expect(() => {
      verifyDownloadToken('tok');
    }).toThrow('Invalid token payload');
  });

  test('uses "test-secret" in test env if FILE_TOKEN_SECRET is missing', async () => {
    const { mod, verifyMock } = await loadModuleWithJWTMock({
      env: {
        NODE_ENV: 'test',
        FILE_TOKEN_SECRET: '', // force "missing"
      },
      verifyImpl: jest.fn(() => ({
        p: 'media/test.png',
        o: 1,
        u: 'file',
        aud: 'download',
        iss: 'chatforia',
      })),
    });

    const { verifyDownloadToken } = mod;

    const out = verifyDownloadToken('abc123');
    expect(out.path).toBe('media/test.png');

    const [_token, secretArg] = verifyMock.mock.calls[0];
    expect(secretArg).toBe('test-secret');
  });

  test('throws if no FILE_TOKEN_SECRET and not in test env', async () => {
    const { mod } = await loadModuleWithJWTMock({
      env: {
        NODE_ENV: 'production',
        FILE_TOKEN_SECRET: '', // force "missing"
      },
      verifyImpl: jest.fn(() => ({
        p: 'media/ok.png',
        o: 1,
        u: 'file',
        aud: 'download',
        iss: 'chatforia',
      })),
    });

    const { verifyDownloadToken } = mod;
    expect(() => {
      verifyDownloadToken('abc123');
    }).toThrow(
      'FILE_TOKEN_SECRET is required for signed download URLs'
    );
  });
});
