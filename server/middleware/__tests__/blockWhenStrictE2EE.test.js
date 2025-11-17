import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';

let prismaMock;
let boomBadRequestMock;

// Mock prisma client used by the middleware
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

// Mock @hapi/boom default export
await jest.unstable_mockModule('@hapi/boom', () => {
  boomBadRequestMock = jest.fn((message, data) => {
    // return a simple error-like object we can assert on
    const err = new Error(message);
    err.isBoom = true;
    err.data = data;
    return err;
  });

  return {
    __esModule: true,
    default: {
      badRequest: boomBadRequestMock,
    },
  };
});

// Import middleware AFTER mocks
const { default: blockWhenStrictE2EE } = await import('../blockWhenStrictE2EE.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('blockWhenStrictE2EE middleware', () => {
  test('calls next() with Boom error when strictE2EE is true', async () => {
    const req = { user: { id: 123 } };
    const next = jest.fn();

    prismaMock.user.findUnique.mockResolvedValueOnce({ strictE2EE: true });

    await blockWhenStrictE2EE(req, {}, next);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: { strictE2EE: true },
    });

    // next should be called once with the Boom error
    expect(next).toHaveBeenCalledTimes(1);
    const [err] = next.mock.calls[0];

    expect(err).toBeInstanceOf(Error);
    expect(err.isBoom).toBe(true);
    expect(err.message).toBe('AI/Translate disabled under Strict E2EE');
    expect(err.data).toEqual({ data: { code: 'STRICT_E2EE_ENABLED' } });

    // Boom.badRequest should have been invoked with correct args
    expect(boomBadRequestMock).toHaveBeenCalledWith(
      'AI/Translate disabled under Strict E2EE',
      { data: { code: 'STRICT_E2EE_ENABLED' } }
    );
  });

  test('calls next() with no error when strictE2EE is falsey', async () => {
    const req = { user: { id: 456 } };
    const next = jest.fn();

    // returns user with strictE2EE false
    prismaMock.user.findUnique.mockResolvedValueOnce({ strictE2EE: false });

    await blockWhenStrictE2EE(req, {}, next);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 456 },
      select: { strictE2EE: true },
    });

    // next called once with no args (no error)
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0].length).toBe(0);
    expect(boomBadRequestMock).not.toHaveBeenCalled();
  });

  test('calls next() with no error when user record is missing', async () => {
    const req = { user: { id: 999 } };
    const next = jest.fn();

    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    await blockWhenStrictE2EE(req, {}, next);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 999 },
      select: { strictE2EE: true },
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0].length).toBe(0);
    expect(boomBadRequestMock).not.toHaveBeenCalled();
  });

  test('propagates errors from prisma via next(err)', async () => {
    const req = { user: { id: 1 } };
    const next = jest.fn();
    const dbError = new Error('DB is down');

    prismaMock.user.findUnique.mockRejectedValueOnce(dbError);

    await blockWhenStrictE2EE(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(dbError);
  });
});
