import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

jest.useFakeTimers();

// ---- Global env snapshot ----
const ORIGINAL_ENV = { ...process.env };

// ---- Mocks ----
let verifyMock;
const prismaMock = {
  user: {
    findUnique: jest.fn(),
  },
};

// ESM-safe mock setup
const setupMocks = () => {
  // jsonwebtoken mock
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

  // prisma client mock – MUST match auth.js import
  // auth.js: import prisma from '../utils/prismaClient.js';
  jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));
};

// Register mocks initially
setupMocks();

// ---- Helpers ----
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

  // Reset env for predictable behavior
  process.env = { ...ORIGINAL_ENV, NODE_ENV: 'test' };
  delete process.env.JWT_COOKIE_NAME; // default: foria_jwt
  delete process.env.JWT_SECRET;      // auth.js uses 'test_secret' in NODE_ENV=test

  // Reset mocks
  prismaMock.user.findUnique.mockReset();

  // Re-apply ESM mocks after resetModules
  setupMocks();

  return import('../auth.js');
};

// ---- Lifecycle ----
afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.user.findUnique.mockReset();
  if (verifyMock) verifyMock.mockReset();
});

// ---- Tests ----
describe('auth middleware', () => {
  describe('requireAuth', () => {
    test('ignores pre-set req.user and still requires a valid token cookie', async () => {
      const mod = await loadModule();
      const { req, res, next } = makeReqResNext({
        // Pretend some upstream middleware set req.user, but no cookie is present
        req: { user: { id: 123, role: 'USER' } },
      });

      await mod.requireAuth(req, res, next);

      // New contract: must have a valid JWT cookie, otherwise 401
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
    });

    test('401 when no token cookie present', async () => {
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
      verifyMock.mockReturnValue({}); // no id

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
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 42,
        username: 'dbU',
        role: 'ADMIN',
        plan: 'PLUS',
        email: 'db@example.com',
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
          role: true,
          plan: true,
        },
      });
      expect(req.user).toEqual({
        id: 42,
        username: 'dbU',
        role: 'ADMIN',
        email: 'db@example.com',
        plan: 'PLUS',
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
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: 5,
        username: 'alice_db',
        role: 'USER',
        plan: 'PLUS',
        email: 'alice@db.com',
      });

      const { req, res, next } = makeReqResNext({
        req: { cookies: { foria_jwt: 'ok' } },
      });

      await mod.verifyTokenOptional(req, res, next);

      expect(req.user).toEqual({
        id: 5,
        username: 'alice_db',
        role: 'USER',
        email: 'alice@db.com',
        plan: 'PLUS',
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
      const { req, res, next } = makeReqResNext(); // no user

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

  describe('bearer header is ignored in these middlewares', () => {
    test('Authorization: Bearer is ignored because allowBearer=false', async () => {
      const mod = await loadModule();
      verifyMock.mockReturnValue({ id: '1' });

      const { req, res, next } = makeReqResNext({
        req: { headers: { authorization: 'Bearer should-be-ignored' } },
      });

      await mod.requireAuth(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._json).toEqual({ error: 'Unauthorized' });
    });
  });
});
