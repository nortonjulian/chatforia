const ORIGINAL_ENV = process.env;

// ---- Mocks ----
const cookieParseMock = jest.fn();
jest.mock('cookie', () => ({
  __esModule: true,
  default: { parse: (...args) => cookieParseMock(...args) },
}));

const jwtVerifyMock = jest.fn();
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { verify: (...args) => jwtVerifyMock(...args) },
  verify: (...args) => jwtVerifyMock(...args),
}));

// Suppress the temporary console.log in middleware
const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

// Helper: reload module with given env
const reloadWithEnv = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  cookieParseMock.mockReset();
  jwtVerifyMock.mockReset();
  return import('../socketAuth.js');
};

// Build a fake Socket.IO server and capture the middleware registered via io.use
const makeIoAndCaptureMw = (mod) => {
  const io = { use: jest.fn() };
  mod.cookieSocketAuth(io);
  expect(io.use).toHaveBeenCalledTimes(1);
  const mw = io.use.mock.calls[0][0];
  return { io, mw };
};

// Make a fake socket + next
const makeSocket = (overrides = {}) => {
  const socket = {
    handshake: { headers: {}, auth: {}, query: {}, ...(overrides.handshake || {}) },
    join: jest.fn(),
    data: {},
  };
  const next = jest.fn();
  return { socket, next };
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
  consoleSpy.mockRestore();
});

describe('cookieSocketAuth middleware', () => {
  test('auth via cookie (default cookie name "foria_jwt") attaches user and joins room', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: 's3cr3t', JWT_COOKIE_NAME: undefined });

    // Cookie parse returns default cookie name
    cookieParseMock.mockReturnValue({ foria_jwt: 'cookieTok' });

    // jwt.verify returns a payload
    jwtVerifyMock.mockReturnValue({ id: 42, username: 'bob', role: 'USER', plan: 'FREE' });

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket({
      handshake: { headers: { cookie: 'foria_jwt=cookieTok' } },
    });

    await mw(socket, next);

    expect(cookieParseMock).toHaveBeenCalled();
    expect(jwtVerifyMock).toHaveBeenCalledWith('cookieTok', 's3cr3t');

    expect(socket.user).toEqual({ id: 42, username: 'bob', role: 'USER', plan: 'FREE' });
    expect(socket.data.user).toEqual({ id: 42, username: 'bob', role: 'USER', plan: 'FREE' });
    expect(socket.join).toHaveBeenCalledWith('user:42');

    expect(next).toHaveBeenCalledWith(); // no error
  });

  test('auth via handshake.auth.token when no cookie present', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: 'sekret' });
    cookieParseMock.mockReturnValue({}); // no cookie
    jwtVerifyMock.mockReturnValue({ id: 7 });

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket({
      handshake: { auth: { token: 'authTok' }, headers: {} },
    });

    await mw(socket, next);

    expect(jwtVerifyMock).toHaveBeenCalledWith('authTok', 'sekret');
    expect(socket.user).toEqual({ id: 7 });
    expect(socket.join).toHaveBeenCalledWith('user:7');
    expect(next).toHaveBeenCalledWith();
  });

  test('auth via handshake.query.token when no cookie/auth present', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: 'sekret' });
    cookieParseMock.mockReturnValue({});
    jwtVerifyMock.mockReturnValue({ id: 9 });

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket({
      handshake: { query: { token: 'qTok' } },
    });

    await mw(socket, next);

    expect(jwtVerifyMock).toHaveBeenCalledWith('qTok', 'sekret');
    expect(socket.user).toEqual({ id: 9 });
    expect(socket.join).toHaveBeenCalledWith('user:9');
    expect(next).toHaveBeenCalledWith();
  });

  test('custom cookie name respected via JWT_COOKIE_NAME', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: 's', JWT_COOKIE_NAME: 'chatforia_auth' });
    cookieParseMock.mockReturnValue({ chatforia_auth: 'ckTok' });
    jwtVerifyMock.mockReturnValue({ id: 123 });

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket({
      handshake: { headers: { cookie: 'chatforia_auth=ckTok' } },
    });

    await mw(socket, next);

    expect(jwtVerifyMock).toHaveBeenCalledWith('ckTok', 's');
    expect(socket.user).toEqual({ id: 123 });
    expect(socket.join).toHaveBeenCalledWith('user:123');
    expect(next).toHaveBeenCalledWith();
  });

  test('no token anywhere → Unauthorized error', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: 's3cr3t' });
    cookieParseMock.mockReturnValue({}); // no cookie

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket();

    await mw(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Unauthorized');
  });

  test('missing JWT_SECRET → configuration error', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: undefined }); // not set
    cookieParseMock.mockReturnValue({ foria_jwt: 'token' });

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket({
      handshake: { headers: { cookie: 'foria_jwt=token' } },
    });

    await mw(socket, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Server misconfiguration: JWT secret missing');
  });

  test('invalid token (jwt.verify throws) → Unauthorized', async () => {
    const mod = await reloadWithEnv({ JWT_SECRET: 's3cr3t' });
    cookieParseMock.mockReturnValue({ foria_jwt: 'bad' });
    jwtVerifyMock.mockImplementation(() => { throw new Error('invalid'); });

    const { mw } = makeIoAndCaptureMw(mod);
    const { socket, next } = makeSocket({
      handshake: { headers: { cookie: 'foria_jwt=bad' } },
    });

    await mw(socket, next);

    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Unauthorized');
  });
});
