import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

jest.useFakeTimers();

const ORIGINAL_ENV = { ...process.env };

let verifyMock;

const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
};

const setupMocks = () => {
  jest.unstable_mockModule('jsonwebtoken', () => {
    verifyMock = jest.fn();

    return {
      __esModule: true,
      default: {
        verify: (...args) => verifyMock(...args),
      },
      verify: (...args) => verifyMock(...args),
    };
  });

  jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));
};

setupMocks();

const makeReqResNext = (overrides = {}) => {
  const req = {
    method: 'GET',
    headers: {},
    cookies: {},
    user: undefined,
    ...overrides.req,
  };

  const emitter = new EventEmitter();

  const res = Object.assign(emitter, {
    statusCode: 200,
    _json: null,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v;
    },
    getHeader(k) {
      return this.headers[k];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this._json = obj;
      return this;
    },
    end: jest.fn(),
  });

  const next = jest.fn();

  return { req, res, next };
};

const loadModule = async () => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
  };

  delete process.env.JWT_COOKIE_NAME;
  delete process.env.JWT_SECRET;

  prismaMock.user.findUnique.mockReset();

  setupMocks();

  return import('../auth.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.findUnique.mockReset();

  if (verifyMock) {
    verifyMock.mockReset();
  }
});

describe('auth middleware', () => {
  describe('requireAuth', () => {
    test('ignores pre-set req.user and still requires a valid token cookie or bearer token', async () => {
      const mod = await loadModule();

      const { req, res, next } = makeReqResNext({
        req: { user: { id: 123, role: 'USER' } },
      });

      await mod.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
    });

    test('401 when no token present', async () => {
      const mod = await loadModule();

      const { req, res, next } = makeReqResNext();

      await mod.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
    });

    test('401 when jwt.verify throws', async () => {
      const mod = await loadModule();

      verifyMock.mockImplementation(() => {
        throw new Error('bad token');
      });

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'token123' } },
      });

      await mod.requireAuth(req, res, next);

      expect(verifyMock).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
    });

    test('401 when decoded token missing id', async () => {
      const mod = await loadModule();

      verifyMock.mockReturnValue({});

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'token123' } },
      });

      await mod.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
    });

    test('sets req.user using freshest DB values when token valid', async () => {
      const mod = await loadModule();

      verifyMock.mockReturnValue({
        id: '42',
        username: 'cookieU',
        role: 'USER',
        plan: 'FREE',
        email: 'cookie@example.com',
        tokenVersion: 0,
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 42,
        username: 'dbU',
        role: 'ADMIN',
        plan: 'PLUS',
        email: 'db@example.com',
        publicKey: 'pub-db',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twoFactorEnabled: false,
        preferredLanguage: 'en',
        theme: 'dawn',
        avatarUrl: null,
        tokenVersion: 0,
      });

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'token123' } },
      });

      await mod.requireAuth(req, res, next);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: {
          id: true,
          email: true,
          username: true,
          publicKey: true,
          role: true,
          plan: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          twoFactorEnabled: true,
          preferredLanguage: true,
          theme: true,
          avatarUrl: true,
          tokenVersion: true,
        },
      });

      expect(req.user).toEqual({
        id: 42,
        username: 'dbU',
        email: 'db@example.com',
        publicKey: 'pub-db',
        role: 'ADMIN',
        plan: 'PLUS',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twoFactorEnabled: false,
        preferredLanguage: 'en',
        theme: 'dawn',
        avatarUrl: null,
        tokenVersion: 0,
      });

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('falls back to decoded values when DB user not found', async () => {
      const mod = await loadModule();

      verifyMock.mockReturnValue({
        id: '7',
        username: 'cookieOnly',
        role: 'USER',
        plan: 'FREE',
        email: 'c@e.com',
        tokenVersion: 0,
      });

      prismaMock.user.findUnique.mockResolvedValue(null);

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'token123' } },
      });

      await mod.requireAuth(req, res, next);

      expect(req.user).toEqual({
        id: 7,
        username: 'cookieOnly',
        role: 'USER',
        email: 'c@e.com',
        plan: 'FREE',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twoFactorEnabled: false,
        preferredLanguage: 'en',
        theme: 'dawn',
        avatarUrl: null,
        tokenVersion: 0,
      });

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('verifyTokenOptional', () => {
    test('continues with no req.user when no token', async () => {
      const mod = await loadModule();

      const { req, res, next } = makeReqResNext();

      await mod.verifyTokenOptional(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeUndefined();
    });

    test('continues without setting user when verify throws', async () => {
      const mod = await loadModule();

      verifyMock.mockImplementation(() => {
        throw new Error('expired');
      });

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'bad' } },
      });

      await mod.verifyTokenOptional(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toBeUndefined();
    });

    test('sets req.user when token valid', async () => {
      const mod = await loadModule();

      verifyMock.mockReturnValue({
        id: '5',
        username: 'alice',
        role: 'USER',
        plan: 'FREE',
        email: 'a@b.com',
        tokenVersion: 0,
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 5,
        username: 'alice_db',
        role: 'USER',
        plan: 'PLUS',
        email: 'alice@db.com',
        publicKey: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twoFactorEnabled: false,
        preferredLanguage: 'en',
        theme: 'dawn',
        avatarUrl: null,
        tokenVersion: 0,
      });

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'ok' } },
      });

      await mod.verifyTokenOptional(req, res, next);

      expect(req.user).toEqual({
        id: 5,
        username: 'alice_db',
        email: 'alice@db.com',
        publicKey: null,
        role: 'USER',
        plan: 'PLUS',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twoFactorEnabled: false,
        preferredLanguage: 'en',
        theme: 'dawn',
        avatarUrl: null,
        tokenVersion: 0,
      });

      expect(next).toHaveBeenCalledTimes(1);
    });

    test('does not clobber existing req.user', async () => {
      const mod = await loadModule();

      const { req, res, next } = makeReqResNext({
        req: {
          user: { id: 99, role: 'ADMIN' },
          cookies: { foria_jwt: 'ignored' },
        },
      });

      await mod.verifyTokenOptional(req, res, next);

      expect(req.user).toEqual({ id: 99, role: 'ADMIN' });
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('requireAdmin', () => {
    test('403 when not admin or missing user', async () => {
      const mod = await loadModule();

      const { req, res, next } = makeReqResNext();

      mod.requireAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res._json).toEqual({ error: 'Admin access required' });
    });

    test('next() when role is ADMIN', async () => {
      const mod = await loadModule();

      const { req, res, next } = makeReqResNext({
        req: { user: { id: 1, role: 'ADMIN' } },
      });

      mod.requireAdmin(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res._json).toBeNull();
    });
  });

  describe('bearer header support', () => {
    test('Authorization: Bearer is accepted', async () => {
      const mod = await loadModule();

      verifyMock.mockReturnValue({
        id: '1',
        username: 'bearerUser',
        role: 'USER',
        plan: 'FREE',
        email: 'bearer@example.com',
        tokenVersion: 0,
      });

      prismaMock.user.findUnique.mockResolvedValue(null);

      const { req, res, next } = makeReqResNext({
        req: {
          headers: {
            authorization: 'Bearer bearer-token',
          },
        },
      });

      await mod.requireAuth(req, res, next);

      expect(verifyMock).toHaveBeenCalledWith('bearer-token', 'test_secret');
      expect(next).toHaveBeenCalledTimes(1);
      expect(res._json).toBeNull();
      expect(req.user).toEqual({
        id: 1,
        username: 'bearerUser',
        role: 'USER',
        email: 'bearer@example.com',
        plan: 'FREE',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        twoFactorEnabled: false,
        preferredLanguage: 'en',
        theme: 'dawn',
        avatarUrl: null,
        tokenVersion: 0,
      });
    });
  });
});