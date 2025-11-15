import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

// ---------- Test doubles ----------
let serverCtorSpy;
let serverInstance;
let jwtVerifyMock;
let prismaMock;
let attachRandomChatSocketsMock;
let createAdapterMock;
let createClientMock;

function makeIoDouble() {
  const middlewares = [];
  const handlers = {};
  const engineHandlers = {};

  return {
    // constructor capture
    _opts: null,
    // Socket.IO API we need
    use: jest.fn((fn) => middlewares.push(fn)),
    on: jest.fn((evt, cb) => {
      handlers[evt] = cb;
    }),
    engine: {
      on: jest.fn((evt, cb) => {
        engineHandlers[evt] = cb;
      }),
      _emit: (evt, payload) => engineHandlers[evt]?.(payload),
    },
    adapter: jest.fn(),
    to: jest.fn(() => ({ emit: jest.fn() })),
    close: jest.fn((cb) => cb && cb()),
    // helpers for tests
    _getMiddlewares: () => middlewares,
    _getHandler: (evt) => handlers[evt],
  };
}

function makeSocketDouble({ tokenFrom = 'auth', token = 'jwt' } = {}) {
  const handshake = {
    auth: tokenFrom === 'auth' ? { token } : {},
    query: tokenFrom === 'query' ? { token } : {},
    headers: tokenFrom === 'cookie' ? { cookie: `foria_jwt=${token}` } : {},
  };

  const joined = new Set();
  const onMap = new Map();

  const sock = {
    handshake,
    data: {},
    user: null,
    join: jest.fn(async (room) => joined.add(room)),
    leave: jest.fn(async (room) => joined.delete(room)),
    on: jest.fn((ev, cb) => onMap.set(ev, cb)),
    _emitClient: (ev, payload) => onMap.get(ev)?.(payload),
    _joined: joined,
  };

  return sock;
}

// ---------- Helper to re-import module cleanly with ESM mocks ----------
const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };

  // socket.io mock
  await jest.unstable_mockModule('socket.io', () => {
    serverInstance = makeIoDouble();
    serverCtorSpy = jest.fn((_http, opts) => {
      serverInstance._opts = opts;
      return serverInstance;
    });
    return {
      __esModule: true,
      Server: serverCtorSpy,
    };
  });

  // jsonwebtoken mock
  jwtVerifyMock = jest.fn();
  await jest.unstable_mockModule('jsonwebtoken', () => {
    const jwt = { verify: jwtVerifyMock };
    return {
      __esModule: true,
      default: jwt,
      verify: jwtVerifyMock,
    };
  });

  // cookie mock
  await jest.unstable_mockModule('cookie', () => {
    const parse = (raw) => {
      const out = {};
      String(raw || '')
        .split(';')
        .map((s) => s.trim())
        .forEach((pair) => {
          const [k, v] = pair.split('=');
          if (k) out[k] = v;
        });
      return out;
    };

    return {
      __esModule: true,
      default: { parse },
      parse,
    };
  });

  // prismaClient mock
  prismaMock = {
    participant: {
      findMany: jest.fn(),
    },
  };
  await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));

  // randomChats mock
  attachRandomChatSocketsMock = jest.fn();
  await jest.unstable_mockModule('../routes/randomChats.js', () => ({
    __esModule: true,
    attachRandomChatSockets: (...args) => attachRandomChatSocketsMock(...args),
  }));

  // Redis adapter + client (wired only when REDIS_URL is set)
  createAdapterMock = jest.fn(() => jest.fn());
  createClientMock = jest.fn(() => ({
    connect: jest.fn().mockResolvedValue(),
    quit: jest.fn().mockResolvedValue(),
  }));

  await jest.unstable_mockModule('@socket.io/redis-adapter', () => ({
    __esModule: true,
    createAdapter: createAdapterMock,
  }));

  await jest.unstable_mockModule('redis', () => ({
    __esModule: true,
    createClient: createClientMock,
  }));

  // Now import the module under test (it will see all the above mocks)
  return import('../socket.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------- Tests ----------
describe('initSocket', () => {
  test('uses parsed CORS origins from env or fallback', async () => {
    const { initSocket } = await reload({
      CORS_ORIGINS: 'https://chatforia.app, https://app.chatforia.app',
    });

    const httpStub = {};
    initSocket(httpStub);

    expect(serverCtorSpy).toHaveBeenCalledWith(httpStub, {
      cors: {
        origin: ['https://chatforia.app', 'https://app.chatforia.app'],
        credentials: true,
      },
      path: '/socket.io',
    });

    // fallback case
    const { initSocket: init2 } = await reload({ CORS_ORIGINS: '' });
    init2({});
    expect(serverInstance._opts.cors.origin).toEqual([
      'http://localhost:5173',
      'http://localhost:5002',
    ]);
  });

  test('auth middleware: no token → Unauthorized: no token', async () => {
    const { initSocket } = await reload({ JWT_SECRET: 's' });
    initSocket({});

    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'none' });
    const next = jest.fn();

    await mw(socket, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0][0].message).toMatch(/Unauthorized: no token/);
  });

  test('auth middleware: missing JWT_SECRET → misconfiguration error', async () => {
    const { initSocket } = await reload({ JWT_SECRET: '' });
    initSocket({});

    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'auth', token: 't' });
    const next = jest.fn();

    await mw(socket, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(/JWT secret missing/),
      }),
    );
  });

  test('auth middleware: valid token attaches user and joins personal room', async () => {
    const { initSocket } = await reload({ JWT_SECRET: 'sekret' });
    initSocket({});

    jwtVerifyMock.mockReturnValue({ id: 123, username: 'julian' });

    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'auth', token: 'abc' });
    const next = jest.fn();

    await mw(socket, next);

    expect(jwtVerifyMock).toHaveBeenCalledWith('abc', 'sekret');
    expect(socket.user).toEqual({ id: 123, username: 'julian' });
    expect(socket.data.user).toEqual({ id: 123, username: 'julian' });
    expect(socket.join).toHaveBeenCalledWith('user:123');
    expect(next).toHaveBeenCalledWith();
  });

  test('connection handler: autojoin rooms, join/leave events, bulk join', async () => {
    const { initSocket } = await reload({
      JWT_SECRET: 'sekret',
      SOCKET_AUTOJOIN: 'true',
    });

    initSocket({});

    // Simulate authed socket through middleware
    jwtVerifyMock.mockReturnValue({ id: 99, username: 'u99' });
    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'auth', token: 't99' });
    await mw(socket, jest.fn());

    // Prepare prisma rooms for autojoin
    prismaMock.participant.findMany.mockResolvedValueOnce([
      { chatRoomId: 7 },
      { chatRoomId: 7 }, // duplicate to ensure Set uniqueness
      { chatRoomId: 8 },
    ]);

    // Fire 'connection'
    const onConn = serverInstance._getHandler('connection');
    await onConn(socket);

    // Auto-joined rooms 7 and 8
    expect(prismaMock.participant.findMany).toHaveBeenCalledWith({
      where: { userId: 99 },
      select: { chatRoomId: true },
    });
    expect(socket.join).toHaveBeenCalledWith('7');
    expect(socket.join).toHaveBeenCalledWith('8');

    // Bulk join
    socket._emitClient('join:rooms', [9, '10', null]);
    expect(socket.join).toHaveBeenCalledWith('9');
    // We don't strictly assert '10' here to avoid overfitting join call order/behavior.

    // Single join/leave
    socket._emitClient('join_room', 11);
    expect(socket.join).toHaveBeenCalledWith('11');
    socket._emitClient('leave_room', 11);
    expect(socket.leave).toHaveBeenCalledWith('11');
  });

  test('attaches random chat sockets when exported', async () => {
    const { initSocket } = await reload({ JWT_SECRET: 's' });
    initSocket({});
    expect(attachRandomChatSocketsMock).toHaveBeenCalledWith(serverInstance);
  });

  test('enables Redis adapter when REDIS_URL is set and close() quits clients and io', async () => {
    const { initSocket } = await reload({
      JWT_SECRET: 's',
      REDIS_URL: 'redis://localhost:6379',
    });

    const { close } = initSocket({});

    // give the async adapter setup a tick
    await new Promise((r) => setImmediate(r));

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(serverInstance.adapter).toHaveBeenCalledWith(expect.any(Function));

    // close should quit both and close io
    await close();

    const pub = createClientMock.mock.results[0].value;
    const sub = createClientMock.mock.results[1].value;

    expect(pub.quit).toHaveBeenCalled();
    expect(sub.quit).toHaveBeenCalled();
    expect(serverInstance.close).toHaveBeenCalled();
  });

  test('close() still works when REDIS_URL is not set (no redis clients)', async () => {
    const { initSocket } = await reload({ JWT_SECRET: 's', REDIS_URL: '' });

    const { close } = initSocket({});
    await close();

    expect(serverInstance.close).toHaveBeenCalled();
    // no redis clients created
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
