import { jest } from '@jest/globals';

// We will re-import the module under different envs — isolate module state each time.
const ORIGINAL_ENV = { ...process.env };

// We'll capture the csurf mock so tests can inspect calls.
let csurfMock;

// Helper to register the csurf mock (ESM-safe)
const setupCsurfMock = () => {
  jest.unstable_mockModule('csurf', () => {
    csurfMock = jest.fn((_opts) => {
      const mw = jest.fn((req, res, next) => next && next());
      mw._isCsurf = true;
      return mw;
    });

    return {
      __esModule: true,
      default: (...args) => csurfMock(...args),
    };
  });
};

// Register the mock before any imports happen
setupCsurfMock();

// Helper: load the module fresh with a specific env map
const loadModuleWithEnv = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // Re-apply csurf mock after resetModules, before importing the module under test
  setupCsurfMock();

  // dynamic import after env is set
  return import('../csrf.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---- Tests ----

describe('buildCsrf()', () => {
  test('returns NOOP when NODE_ENV=test', async () => {
    const { buildCsrf } = await loadModuleWithEnv({ NODE_ENV: 'test' });

    // In test env, buildCsrf should not call csurf at all
    const mw = buildCsrf();
    expect(typeof mw).toBe('function');

    const next = jest.fn();
    mw({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);

    expect(csurfMock).not.toHaveBeenCalled();
  });

  test('constructs csurf with non-prod cookie (secure=false) when NODE_ENV=development', async () => {
    const { buildCsrf } = await loadModuleWithEnv({ NODE_ENV: 'development' });

    // Clear out the call from default export created on import
    csurfMock.mockClear();

    const mw = buildCsrf(); // default isProd inferred from NODE_ENV
    expect(mw._isCsurf).toBe(true);
    expect(csurfMock).toHaveBeenCalledTimes(1);

    const opts = csurfMock.mock.calls[0][0];
    expect(opts.cookie).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    // domain should not be present outside prod unless explicitly passed
    expect(opts.cookie.domain).toBeUndefined();
  });

  test('constructs csurf with prod cookie (secure=true) and domain when isProd=true + cookieDomain provided', async () => {
    const { buildCsrf } = await loadModuleWithEnv({ NODE_ENV: 'development' });

    // Clear out default export call
    csurfMock.mockClear();

    const mw = buildCsrf({ isProd: true, cookieDomain: 'chatforia.com' });
    expect(mw._isCsurf).toBe(true);
    expect(csurfMock).toHaveBeenCalledTimes(1);

    const opts = csurfMock.mock.calls[0][0];
    expect(opts.cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: 'chatforia.com',
    });
  });

  test('value extractor checks headers/body/query/cookies in order', async () => {
    const { buildCsrf } = await loadModuleWithEnv({ NODE_ENV: 'development' });

    // Clear out default export call
    csurfMock.mockClear();

    buildCsrf(); // triggers csurfMock; capture opts
    const { value } = csurfMock.mock.calls[0][0];

    // 1) req.get('x-csrf-token')
    const req1 = {
      get: (k) => (k === 'x-csrf-token' ? 'from-get' : undefined),
      headers: {},
      body: {},
      query: {},
      cookies: {},
    };
    expect(value(req1)).toBe('from-get');

    // 2) headers['x-csrf-token']
    const req2 = {
      get: () => undefined,
      headers: { 'x-csrf-token': 'from-header' },
      body: {},
      query: {},
      cookies: {},
    };
    expect(value(req2)).toBe('from-header');

    // 3) headers['x-xsrf-token']
    const req3 = {
      get: () => undefined,
      headers: { 'x-xsrf-token': 'from-xsrf' },
      body: {},
      query: {},
      cookies: {},
    };
    expect(value(req3)).toBe('from-xsrf');

    // 4) body._csrf
    const req4 = {
      get: () => undefined,
      headers: {},
      body: { _csrf: 'from-body' },
      query: {},
      cookies: {},
    };
    expect(value(req4)).toBe('from-body');

    // 5) query._csrf
    const req5 = {
      get: () => undefined,
      headers: {},
      body: {},
      query: { _csrf: 'from-query' },
      cookies: {},
    };
    expect(value(req5)).toBe('from-query');

    // 6) cookies['XSRF-TOKEN']
    const req6 = {
      get: () => undefined,
      headers: {},
      body: {},
      query: {},
      cookies: { 'XSRF-TOKEN': 'from-cookie' },
    };
    expect(value(req6)).toBe('from-cookie');

    // fallback to empty string if nothing matches
    const req7 = {
      get: () => undefined,
      headers: {},
      body: {},
      query: {},
      cookies: {},
    };
    expect(value(req7)).toBe('');
  });
});

describe('setCsrfCookie()', () => {
  test('no-ops in test env', async () => {
    const { setCsrfCookie } = await loadModuleWithEnv({ NODE_ENV: 'test' });

    const req = { csrfToken: jest.fn(() => 'abc') };
    const res = { cookie: jest.fn() };
    setCsrfCookie(req, res);

    expect(req.csrfToken).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('no-ops if req.csrfToken is not a function', async () => {
    const { setCsrfCookie } = await loadModuleWithEnv({
      NODE_ENV: 'development',
    });

    const req = {}; // csrfToken missing
    const res = { cookie: jest.fn() };
    setCsrfCookie(req, res);

    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('sets XSRF-TOKEN cookie in development (secure=false, no domain)', async () => {
    const { setCsrfCookie } = await loadModuleWithEnv({
      NODE_ENV: 'development',
    });

    const req = { csrfToken: jest.fn(() => 'token-123') };
    const res = { cookie: jest.fn() };

    setCsrfCookie(req, res);

    expect(req.csrfToken).toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith(
      'XSRF-TOKEN',
      'token-123',
      expect.objectContaining({
        httpOnly: false,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 2 * 60 * 60 * 1000,
      })
    );
    // no domain in dev
    const opts = res.cookie.mock.calls[0][2];
    expect(opts.domain).toBeUndefined();
  });

  test('sets XSRF-TOKEN cookie in production (secure=true) and respects COOKIE_DOMAIN', async () => {
    const { setCsrfCookie } = await loadModuleWithEnv({
      NODE_ENV: 'production',
      COOKIE_DOMAIN: 'chatforia.com',
    });

    const req = { csrfToken: jest.fn(() => 'prod-token') };
    const res = { cookie: jest.fn() };

    setCsrfCookie(req, res);

    expect(res.cookie).toHaveBeenCalledWith(
      'XSRF-TOKEN',
      'prod-token',
      expect.objectContaining({
        httpOnly: false,
        secure: true,
        sameSite: 'lax',
        path: '/',
        domain: 'chatforia.com',
        maxAge: 2 * 60 * 60 * 1000,
      })
    );
  });
});

describe('default export (csrfDefault)', () => {
  test('is NOOP middleware in NODE_ENV=test', async () => {
    const mod = await loadModuleWithEnv({ NODE_ENV: 'test' });
    const mw = mod.default;
    expect(typeof mw).toBe('function');

    const next = jest.fn();
    mw({}, {}, next);
    expect(next).toHaveBeenCalledTimes(1);

    // csurf should not be invoked when test env chooses NOOP
    expect(csurfMock).not.toHaveBeenCalled();
  });

  test('calls csurf with correct cookie opts in production, with COOKIE_DOMAIN', async () => {
    const mod = await loadModuleWithEnv({
      NODE_ENV: 'production',
      COOKIE_DOMAIN: 'chatforia.com',
    });

    // Default export should have been created during import:
    expect(csurfMock).toHaveBeenCalledTimes(1);
    const opts = csurfMock.mock.calls[0][0];

    expect(opts.cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: 'chatforia.com',
    });

    // value extractor still present
    const token = opts.value({
      get: () => 'hdr',
      headers: {},
      body: {},
      query: {},
      cookies: {},
    });
    expect(token).toBe('hdr');
  });

  test('calls csurf with correct cookie opts in development (secure=false, no domain)', async () => {
    const mod = await loadModuleWithEnv({
      NODE_ENV: 'development',
    });

    expect(csurfMock).toHaveBeenCalledTimes(1);
    const opts = csurfMock.mock.calls[0][0];
    expect(opts.cookie).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
    expect(opts.cookie.domain).toBeUndefined();
  });
});
