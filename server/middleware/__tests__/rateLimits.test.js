const ORIGINAL_ENV = process.env;

// ---- Mock express-rate-limit (with simple in-memory enforcement) ----
const rlCallOpts = []; // capture all options passed in
const bucketCounts = new Map(); // key -> count for enforcement

// A simple ipKeyGenerator facsimile
const mockIpKeyGenerator = (req) => {
  // prefer req.ip, then first of req.ips, then connection addr
  return req?.ip || (Array.isArray(req?.ips) && req.ips[0]) || req?.connection?.remoteAddress || 'unknown';
};

// Our rateLimit mock returns a middleware that increments a counter per key
const rateLimitMock = (opts = {}) => {
  rlCallOpts.push(opts);
  const {
    keyGenerator = mockIpKeyGenerator,
    max = 5,
  } = opts;

  return (req, res, next) => {
    const key = keyGenerator(req, res);
    const current = (bucketCounts.get(key) || 0) + 1;
    bucketCounts.set(key, current);

    if (current > max) {
      // simulate express-rate-limit default behavior
      res.statusCode = 429;
      if (typeof res.send === 'function') res.send('Too many requests');
      return;
    }
    return next();
  };
};

jest.mock('express-rate-limit', () => {
  const mod = Object.assign((opts) => rateLimitMock(opts), {
    __esModule: true,
    default: (opts) => rateLimitMock(opts),
    ipKeyGenerator: (...args) => mockIpKeyGenerator(...args),
  });
  return mod;
});

// ---- Helpers to (re)load module with clean state ----
const reloadModuleWithEnv = async (env = {}) => {
  jest.resetModules();
  rlCallOpts.length = 0;
  bucketCounts.clear();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../rateLimits.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  rlCallOpts.length = 0;
  bucketCounts.clear();
});

// -------------------- TESTS --------------------
describe('rateLimits (test env behavior)', () => {
  test('only limiterInvites constructs a limiter in NODE_ENV=test', async () => {
    const mod = await reloadModuleWithEnv({ NODE_ENV: 'test' });

    // All exports exist
    const {
      limiterLogin,
      limiterRegister,
      limiterReset,
      limiterInvites,
      invitesSmsLimiter,
      invitesEmailLimiter,
      limiterAI,
      limiterMedia,
      limiterGenericMutations,
    } = mod;

    // In test env RL() returns a NOOP, RL_TEST_SMS uses real rateLimit
    expect(typeof limiterLogin).toBe('function');
    expect(typeof limiterRegister).toBe('function');
    expect(typeof limiterReset).toBe('function');
    expect(typeof limiterInvites).toBe('function');
    expect(typeof invitesSmsLimiter).toBe('function');
    expect(typeof invitesEmailLimiter).toBe('function');
    expect(typeof limiterAI).toBe('function');
    expect(typeof limiterMedia).toBe('function');
    expect(typeof limiterGenericMutations).toBe('function');

    // Only one real limiter should have been created: limiterInvites
    expect(rlCallOpts).toHaveLength(1);

    const opts = rlCallOpts[0];
    // In test env, isProd = false → windowMs 15s, max 1000
    expect(opts).toMatchObject({
      windowMs: 15 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
    });
    expect(typeof opts.keyGenerator).toBe('function');

    // Verify NOOP pass-through for a disabled limiter (e.g., login)
    const req = { ip: '1.1.1.1' };
    const res = { statusCode: 200, send: jest.fn() };
    const next = jest.fn();

    await limiterLogin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // And limiterInvites actually uses our mock limiter (increments counters)
    const next2 = jest.fn();
    await limiterInvites({ ip: '2.2.2.2' }, { statusCode: 200, send: jest.fn() }, next2);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  test('keyGenerator prefers req.user.id then req.auth.id; falls back to IP', async () => {
    const mod = await reloadModuleWithEnv({ NODE_ENV: 'test' });

    // The only constructed limiter's opts is for limiterInvites
    const { keyGenerator } = rlCallOpts[0];

    // user.id
    expect(keyGenerator({ user: { id: 77 }, ip: '9.9.9.9' })).toBe('u:77');
    // auth.id
    expect(keyGenerator({ auth: { id: 88 }, ip: '8.8.8.8' })).toBe('u:88');
    // fallback to ipKeyGenerator
    expect(keyGenerator({ ip: '7.7.7.7' })).toBe('7.7.7.7');
  });
});

describe('rateLimits (production env behavior)', () => {
  test('all limiters constructed with prod settings; limiterInvites enforces 5/min', async () => {
    const mod = await reloadModuleWithEnv({ NODE_ENV: 'production' });

    const {
      limiterLogin,
      limiterRegister,
      limiterReset,
      limiterInvites,
      invitesSmsLimiter,
      invitesEmailLimiter,
      limiterAI,
      limiterMedia,
      limiterGenericMutations,
    } = mod;

    // In production, EVERY limiter constructs an instance
    // Count how many entries we expect: 9
    expect(rlCallOpts).toHaveLength(9);

    // Find opts for limiterInvites (windowMs 60s, max 5)
    const invitesOpts = rlCallOpts.find((o) => o.windowMs === 60 * 1000 && o.max === 5);
    expect(invitesOpts).toBeTruthy();
    expect(invitesOpts).toMatchObject({
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Enforce: make 6 calls from same key; the 6th should 429
    const req = { ip: '3.3.3.3' };
    const makeRes = () => ({ statusCode: 200, send: jest.fn() });
    const next = jest.fn();

    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      next.mockClear();
      await limiterInvites(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(200);
    }

    const res6 = makeRes();
    next.mockClear();
    await limiterInvites(req, res6, next);
    expect(next).not.toHaveBeenCalled();
    expect(res6.statusCode).toBe(429);
    expect(res6.send).toHaveBeenCalledWith('Too many requests');
  });

  test('keyGenerator in prod still prefers user/auth id over IP', async () => {
    await reloadModuleWithEnv({ NODE_ENV: 'production' });

    // Grab any constructed opts (they all use the same keyGenerator wrapper)
    const { keyGenerator } = rlCallOpts[0];

    expect(keyGenerator({ user: { id: 1 }, ip: '1.1.1.1' })).toBe('u:1');
    expect(keyGenerator({ auth: { id: 2 }, ip: '2.2.2.2' })).toBe('u:2');
    expect(keyGenerator({ ip: '3.3.3.3' })).toBe('3.3.3.3');
  });
});
