import { jest } from '@jest/globals';

const ORIGINAL_ENV = process.env;

const verifyMock = jest.fn();
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: (...args) => verifyMock(...args) },
  verify: (...args) => verifyMock(...args),
}));

const reloadWithEnv = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  verifyMock.mockReset();
  return import('../verifyToken.js').then(m => m.default);
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const makeReqResNext = (overrides = {}) => {
  const req = {
    headers: {},
    cookies: {},
    ...overrides.req,
  };
  const res = {
    statusCode: 200,
    _json: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._json = obj; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
};

describe('verifyToken middleware', () => {
  test('401 when no token provided (no cookie, no bearer)', async () => {
    const verifyToken = await reloadWithEnv({ NODE_ENV: 'test' });
    const { req, res, next } = makeReqResNext();

    await verifyToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res._json).toEqual({ message: 'No token provided' });
  });

  test('403 when jwt.verify throws (invalid token)', async () => {
    const verifyToken = await reloadWithEnv({ NODE_ENV: 'test' });
    verifyMock.mockImplementation(() => { throw new Error('bad'); });

    const { req, res, next } = makeReqResNext({
      req: { cookies: { foria_jwt: 'invalid' } },
    });

    await verifyToken(req, res, next);

    expect(verifyMock).toHaveBeenCalledWith('invalid', 'test_secret');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res._json).toEqual({ message: 'Invalid token' });
  });

  test('accepts valid cookie token (default cookie name)', async () => {
    const verifyToken = await reloadWithEnv({ NODE_ENV: 'test' });
    verifyMock.mockReturnValue({ id: 1, role: 'USER' });

    const { req, res, next } = makeReqResNext({
      req: { cookies: { foria_jwt: 'cookieTok' } },
    });

    await verifyToken(req, res, next);

    expect(verifyMock).toHaveBeenCalledWith('cookieTok', 'test_secret');
    expect(req.user).toEqual({ id: 1, role: 'USER' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._json).toBeNull();
  });

  test('Authorization: Bearer takes precedence over cookie', async () => {
    const verifyToken = await reloadWithEnv({ NODE_ENV: 'test' });
    verifyMock.mockReturnValue({ id: 2, role: 'ADMIN' });

    const { req, res, next } = makeReqResNext({
      req: {
        headers: { authorization: 'Bearer bearerTok' },
        cookies: { foria_jwt: 'cookieTok' }, // should be ignored
      },
    });

    await verifyToken(req, res, next);

    expect(verifyMock).toHaveBeenCalledWith('bearerTok', 'test_secret');
    expect(req.user).toEqual({ id: 2, role: 'ADMIN' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('respects custom cookie name via JWT_COOKIE_NAME', async () => {
    const verifyToken = await reloadWithEnv({
      NODE_ENV: 'test',
      JWT_COOKIE_NAME: 'chatforia_auth',
    });
    verifyMock.mockReturnValue({ id: 3 });

    const { req, res, next } = makeReqResNext({
      req: { cookies: { chatforia_auth: 'ck' } },
    });

    await verifyToken(req, res, next);

    expect(verifyMock).toHaveBeenCalledWith('ck', 'test_secret');
    expect(req.user).toEqual({ id: 3 });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
