import { jest, describe, test, expect, beforeEach, afterAll } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

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
    _opts: null,
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

  return {
    handshake,
    data: {},
    user: null,
    join: jest.fn(async (room) => joined.add(room)),
    leave: jest.fn(async (room) => joined.delete(room)),
    on: jest.fn((ev, cb) => onMap.set(ev, cb)),
    to: jest.fn(() => ({ emit: jest.fn() })),
    _emitClient: async (ev, payload) => onMap.get(ev)?.(payload),
    _joined: joined,
  };
}

const reload = async (env = {}) => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    ...env,
  };

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

  jwtVerifyMock = jest.fn();

  await jest.unstable_mockModule('jsonwebtoken', () => {
    const jwt = { verify: jwtVerifyMock };

    return {
      __esModule: true,
      default: jwt,
      verify: jwtVerifyMock,
    };
  });

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

  prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    participant: {
      findMany: jest.fn(),
    },
  };

  await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));

  await jest.unstable_mockModule('../services/socketBus.js', () => ({
    __esModule: true,
    setSocketIo: jest.fn(),
  }));

  await jest.unstable_mockModule('../sockets/readReceipts.js', () => ({
    __esModule: true,
    registerReadReceipts: jest.fn(),
  }));

  attachRandomChatSocketsMock = jest.fn();

  await jest.unstable_mockModule('../routes/randomChats.js', () => ({
    __esModule: true,
    attachRandomChatSockets: (...args) => attachRandomChatSocketsMock(...args),
  }));

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

  return import('../socket.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

beforeEach(() => {
  jest.clearAllMocks();
});

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

  test('auth middleware: missing JWT_SECRET falls back to test_secret in test env', async () => {
    const { initSocket } = await reload({
      JWT_SECRET: '',
      NODE_ENV: 'test',
    });

    initSocket({});

    jwtVerifyMock.mockReturnValue({ id: 123 });

    prismaMock.user.findUnique.mockResolvedValue({
      id: 123,
      email: 'julian@example.com',
      username: 'julian',
      role: 'USER',
      plan: 'FREE',
      preferredLanguage: 'en',
      riaRemember: false,
    });

    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'auth', token: 't' });
    const next = jest.fn();

    await mw(socket, next);

    expect(jwtVerifyMock).toHaveBeenCalledWith('t', 'test_secret');
    expect(socket.user).toEqual({
      id: 123,
      email: 'julian@example.com',
      username: 'julian',
      role: 'USER',
      plan: 'FREE',
      preferredLanguage: 'en',
      riaRemember: false,
    });
    expect(socket.data.user).toEqual(socket.user);
    expect(socket.join).toHaveBeenCalledWith('user:123');
    expect(next).toHaveBeenCalledWith();
  });

  test('auth middleware: valid token attaches DB user and joins personal room', async () => {
    const { initSocket } = await reload({ JWT_SECRET: 'sekret' });

    initSocket({});

    jwtVerifyMock.mockReturnValue({ id: 123, username: 'julian' });

    prismaMock.user.findUnique.mockResolvedValue({
      id: 123,
      email: 'julian@example.com',
      username: 'julian',
      role: 'USER',
      plan: 'FREE',
      preferredLanguage: 'en',
      riaRemember: false,
    });

    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'auth', token: 'abc' });
    const next = jest.fn();

    await mw(socket, next);

    expect(jwtVerifyMock).toHaveBeenCalledWith('abc', 'sekret');

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        plan: true,
        preferredLanguage: true,
        riaRemember: true,
      },
    });

    expect(socket.user).toEqual({
      id: 123,
      email: 'julian@example.com',
      username: 'julian',
      role: 'USER',
      plan: 'FREE',
      preferredLanguage: 'en',
      riaRemember: false,
    });

    expect(socket.data.user).toEqual(socket.user);
    expect(socket.join).toHaveBeenCalledWith('user:123');
    expect(next).toHaveBeenCalledWith();
  });

  test('connection handler: autojoin rooms, join/leave events, bulk join', async () => {
    const { initSocket } = await reload({
      JWT_SECRET: 'sekret',
      SOCKET_AUTOJOIN: 'true',
    });

    initSocket({});

    jwtVerifyMock.mockReturnValue({ id: 99, username: 'u99' });

    prismaMock.user.findUnique.mockResolvedValue({
      id: 99,
      email: 'u99@example.com',
      username: 'u99',
      role: 'USER',
      plan: 'FREE',
      preferredLanguage: 'en',
      riaRemember: false,
    });

    prismaMock.participant.findMany.mockResolvedValueOnce([
      { chatRoomId: 7 },
      { chatRoomId: 7 },
      { chatRoomId: 8 },
    ]);

    const mw = serverInstance._getMiddlewares()[0];
    const socket = makeSocketDouble({ tokenFrom: 'auth', token: 't99' });

    await mw(socket, jest.fn());

    const onConn = serverInstance._getHandler('connection');

    await onConn(socket);

    expect(prismaMock.participant.findMany).toHaveBeenCalledWith({
      where: { userId: 99 },
      select: { chatRoomId: true },
    });

    expect(socket.join).toHaveBeenCalledWith('7');
    expect(socket.join).toHaveBeenCalledWith('8');

    await socket._emitClient('join:rooms', [9, '10', null]);

    expect(socket.join).toHaveBeenCalledWith('9');
    expect(socket.join).toHaveBeenCalledWith('10');
    expect(socket.join).toHaveBeenCalledWith('null');

    socket._emitClient('join_room', 11);
    expect(socket.join).toHaveBeenCalledWith('11');

    socket._emitClient('leave_room', 11);
    expect(socket.leave).toHaveBeenCalledWith('11');

    socket._emitClient('joinRoom', { roomId: 12 });
    expect(socket.join).toHaveBeenCalledWith('12');

    socket._emitClient('leaveRoom', { roomId: 12 });
    expect(socket.leave).toHaveBeenCalledWith('12');
  });

  test('attaches random chat sockets when exported', async () => {
    const { initSocket } = await reload({ JWT_SECRET: 's' });

    initSocket({});

    await new Promise((r) => setImmediate(r));

    expect(attachRandomChatSocketsMock).toHaveBeenCalledWith(serverInstance);
  });

  test('enables Redis adapter when REDIS_URL is set and close() quits clients and io', async () => {
    const { initSocket } = await reload({
      JWT_SECRET: 's',
      REDIS_URL: 'redis://localhost:6379',
    });

    const { close } = initSocket({});

    await new Promise((r) => setImmediate(r));

    expect(createClientMock).toHaveBeenCalledTimes(2);
    expect(serverInstance.adapter).toHaveBeenCalledWith(expect.any(Function));

    await close();

    const pub = createClientMock.mock.results[0].value;
    const sub = createClientMock.mock.results[1].value;

    expect(pub.quit).toHaveBeenCalled();
    expect(sub.quit).toHaveBeenCalled();
    expect(serverInstance.close).toHaveBeenCalled();
  });

  test('close() still works when REDIS_URL is not set', async () => {
    const { initSocket } = await reload({
      JWT_SECRET: 's',
      REDIS_URL: '',
    });

    const { close } = initSocket({});

    await close();

    expect(serverInstance.close).toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
  });
});