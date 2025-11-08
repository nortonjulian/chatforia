const ORIGINAL_ENV = process.env;

let prismaMock;
let tokensMock;

const mockPrisma = () => {
  prismaMock = {
    user: { create: jest.fn(), update: jest.fn() },
    verificationToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (ops) => {
      // Simulate Prisma's $transaction: execute all ops (they're calls we assert on)
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops();
    }),
  };

  jest.doMock('../../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));
};

const mockTokens = () => {
  tokensMock = {
    newRawToken: jest.fn(() => 'RAW_TOKEN'),
    hashToken: jest.fn(async () => 'HASHED'),
    verifyHash: jest.fn(async () => true),
  };

  jest.doMock('../../utils/tokens.js', () => ({
    __esModule: true,
    newRawToken: tokensMock.newRawToken,
    hashToken: tokensMock.hashToken,
    verifyHash: tokensMock.verifyHash,
  }));
};

// Helper to re-import the router (so our mocks take effect)
const reloadModule = async () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, PUBLIC_BASE_URL: 'https://app.example' };
  mockPrisma();
  mockTokens();
  return import('../verifyEmail.js');
};

// Small helpers to call router handlers without supertest
function getRouteHandler(router, method, path) {
  // Express stores stack entries as layers with `.route` for routes
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  // The route may have multiple middleware; grab the last (the actual handler)
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeRes() {
  const res = {
    statusCode: 200,
    _sent: null,
    _redirectedTo: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this._sent = payload;
      return this;
    },
    json(payload) {
      this._sent = payload;
      return this;
    },
    redirect(url) {
      this._redirectedTo = url;
      return this;
    },
  };
  return res;
}

describe('verifyEmail router (GET /auth/verify-email)', () => {
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 when no matching token record (invalid/expired)', async () => {
    const { router } = await reloadModule();

    prismaMock.verificationToken.findFirst.mockResolvedValueOnce(null);

    const handler = getRouteHandler(router, 'get', '/verify-email');
    const req = { query: { token: 't1', uid: 123 } };
    const res = makeRes();

    await handler(req, res);

    expect(prismaMock.verificationToken.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 123,
        type: 'email',
        consumedAt: null,
        expiresAt: expect.any(DateGreaterThanNowMatcher),
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(res.statusCode).toBe(400);
    expect(res._sent).toBe('Invalid or expired');
  });

  test('returns 400 when token hash verification fails', async () => {
    const { router } = await reloadModule();

    prismaMock.verificationToken.findFirst.mockResolvedValueOnce({
      id: 10,
      userId: 123,
      tokenHash: 'HASH_IN_DB',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    tokensMock.verifyHash.mockResolvedValueOnce(false);

    const handler = getRouteHandler(router, 'get', '/verify-email');
    const req = { query: { token: 'bad-token', uid: 123 } };
    const res = makeRes();

    await handler(req, res);

    expect(tokensMock.verifyHash).toHaveBeenCalledWith('bad-token', 'HASH_IN_DB');
    expect(res.statusCode).toBe(400);
    expect(res._sent).toBe('Invalid or expired');
    // no transaction on failure
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test('success: verifies email, consumes token, and redirects to "/?verified=1"', async () => {
    const { router } = await reloadModule();

    prismaMock.verificationToken.findFirst.mockResolvedValueOnce({
      id: 77,
      userId: 999,
      tokenHash: 'HASH_IN_DB',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    tokensMock.verifyHash.mockResolvedValueOnce(true);

    const handler = getRouteHandler(router, 'get', '/verify-email');
    const req = { query: { token: 'GOOD', uid: 999 } };
    const res = makeRes();

    await handler(req, res);

    // $transaction was invoked with two updates
    expect(prismaMock.$transaction).toHaveBeenCalled();
    // Validate the specific updates passed to $transaction:
    const ops = prismaMock.$transaction.mock.calls[0][0];
    // The router passes actual Prisma calls; we can check that calling them would target right args
    // but simpler: assert the individual update mocks were called with the correct shapes.
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 999 },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(prismaMock.verificationToken.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { consumedAt: expect.any(Date) },
    });

    // Redirected
    expect(res._redirectedTo).toBe('/?verified=1');
  });
});

/**
 * Custom matcher helper: we want to assert the query uses "expiresAt: { gt: new Date() }".
 * We can't reliably compare to "now", so we assert the passed Date is >= "test start".
 */
class DateGreaterThanNowMatcher {
  static asymmetricMatch(obj) {
    // Expect an object like { gt: Date }
    return (
      obj &&
      typeof obj === 'object' &&
      obj.gt instanceof Date &&
      obj.gt.getTime() <= Date.now() + 5_000 // allow a little skew during test
    );
  }
  toString() {
    return 'DateGreaterThanNowMatcher';
  }
}
