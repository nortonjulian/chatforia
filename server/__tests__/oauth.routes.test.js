/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const strategies = {}; // map to toggle google/apple on and off in tests

// Global mock for passport.authenticate
// - For initial /google or /apple: end the response with 200
// - For /callback routes: call next() so the real handler can set cookie + redirect
const authenticateMock = jest.fn((_strategyName, _options) => {
  return (req, res, next) => {
    // simulate a logged-in user for callback handlers
    req.user = { id: 'user-123' };

    if (req.path.endsWith('/callback')) {
      return next();
    }

    // kickoff routes (/google, /apple) normally redirect to provider,
    // but for tests we just terminate with 200
    res.status(200).end();
  };
});

let app;
let jwt;          // this will be the actual jwt object (not the module namespace)
let oauthRouter;

beforeAll(async () => {
  // Env for router module-level constants
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.FRONTEND_URL = 'http://frontend.test';
  delete process.env.COOKIE_DOMAIN; // force non-prod cookie shape

  // Mock passport BEFORE importing the router
  await jest.unstable_mockModule('../auth/passport.js', () => ({
    default: {
      _strategy: jest.fn((name) => strategies[name]),
      authenticate: authenticateMock,
    },
  }));

  // Import jwt and router after mock is set up
  const jwtModule = await import('jsonwebtoken');
  // ESM default export unwrapping (jwt.sign should now exist)
  jwt = jwtModule.default || jwtModule;

  ({ default: oauthRouter } = await import('../routes/oauth.routes.js'));

  const expressApp = express();
  expressApp.use(express.json());
  expressApp.use('/auth', oauthRouter);
  app = expressApp;
});

afterEach(() => {
  jest.restoreAllMocks();
  authenticateMock.mockClear();
  strategies.google = undefined;
  strategies.apple = undefined;
});

describe('oauth.routes', () => {
  test('GET /auth/health returns ok payload', async () => {
    const res = await request(app).get('/auth/health');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, oauth: true });
  });

  test('GET /auth/google returns 501 when Google strategy is not configured', async () => {
    strategies.google = undefined; // no Google strategy

    const res = await request(app).get('/auth/google');

    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ error: 'Google OAuth not configured' });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  test('GET /auth/google calls passport.authenticate with correct options', async () => {
    strategies.google = {}; // enable Google strategy

    const state = 'some-state-value';
    const res = await request(app)
      .get('/auth/google')
      .query({ state });

    expect(authenticateMock).toHaveBeenCalledWith('google', {
      scope: ['profile', 'email'],
      session: false,
      state,
    });

    // our mock terminates kickoff routes with 200
    expect(res.statusCode).toBe(200);
  });

  test('GET /auth/google/callback sets cf_session cookie and redirects to FRONTEND_URL by default', async () => {
    strategies.google = {}; // Google strategy enabled

    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const res = await request(app).get('/auth/google/callback');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://frontend.test');

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/cf_session=mock\.jwt\.token/);
    expect(cookies[0]).toMatch(/HttpOnly/);
    // non-prod => no Secure flag
    expect(cookies[0]).not.toMatch(/Secure/);

    expect(signSpy).toHaveBeenCalledWith(
      { sub: 'user-123' },
      'test-secret',
      { expiresIn: '30d' }
    );
  });

  test('GET /auth/google/callback uses state.next redirect when valid', async () => {
    strategies.google = {}; // Google strategy enabled

    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const nextUrl = 'https://example.com/after/login';
    const stateObj = { next: nextUrl };
    const encodedState = Buffer.from(JSON.stringify(stateObj), 'utf8').toString('base64');

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ state: encodedState });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(nextUrl);
    expect(signSpy).toHaveBeenCalled();
  });

  test('GET /auth/google/callback returns 501 when Google strategy is missing', async () => {
    strategies.google = undefined;

    const res = await request(app).get('/auth/google/callback');

    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ error: 'Google OAuth not configured' });
  });

  test('GET /auth/apple returns 501 when Apple strategy is not configured', async () => {
    strategies.apple = undefined; // no Apple strategy

    const res = await request(app).get('/auth/apple');

    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ error: 'Apple OAuth not configured' });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  test('GET /auth/apple calls passport.authenticate with correct options', async () => {
    strategies.apple = {}; // Apple strategy enabled

    const state = 'apple-state';
    const res = await request(app)
      .get('/auth/apple')
      .query({ state });

    expect(authenticateMock).toHaveBeenCalledWith('apple', {
      scope: ['name', 'email'],
      session: false,
      state,
    });

    // kickoff route ends with 200 in mock
    expect(res.statusCode).toBe(200);
  });

  test('POST /auth/apple/callback sets cf_session cookie and redirects (default FRONTEND_URL)', async () => {
    strategies.apple = {}; // Apple strategy enabled

    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const res = await request(app).post('/auth/apple/callback');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://frontend.test');

    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(/cf_session=mock\.jwt\.token/);
    expect(cookies[0]).toMatch(/HttpOnly/);
    expect(cookies[0]).not.toMatch(/Secure/);

    expect(signSpy).toHaveBeenCalledWith(
      { sub: 'user-123' },
      'test-secret',
      { expiresIn: '30d' }
    );
  });

  test('POST /auth/apple/callback uses state.next redirect when valid', async () => {
    strategies.apple = {}; // Apple strategy enabled

    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const nextUrl = 'https://example.com/apple/after';
    const encodedState = Buffer.from(JSON.stringify({ next: nextUrl }), 'utf8').toString('base64');

    const res = await request(app)
      .post('/auth/apple/callback')
      .query({ state: encodedState });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(nextUrl);
    expect(signSpy).toHaveBeenCalled();
  });

  test('POST /auth/apple/callback returns 501 when Apple strategy is missing', async () => {
    strategies.apple = undefined;

    const res = await request(app).post('/auth/apple/callback');

    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ error: 'Apple OAuth not configured' });
  });

  test('GET /auth/failure returns 401', async () => {
    const res = await request(app).get('/auth/failure');

    expect(res.statusCode).toBe(401);
    expect(res.text).toBe('SSO failed');
  });

  test('GET /auth/debug reports strategies and envSeen flags', async () => {
    strategies.google = {};
    strategies.apple = {};

    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    process.env.GOOGLE_CALLBACK_URL = 'https://example.com/google/callback';
    process.env.APPLE_SERVICE_ID = 'service';
    process.env.APPLE_TEAM_ID = 'team';
    process.env.APPLE_KEY_ID = 'key';
    process.env.APPLE_PRIVATE_KEY = '---PRIVATE KEY---';
    process.env.APPLE_CALLBACK_URL = 'https://example.com/apple/callback';

    const res = await request(app).get('/auth/debug');

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      hasGoogle: true,
      hasApple: true,
      envSeen: {
        GOOGLE_CLIENT_ID: true,
        GOOGLE_CLIENT_SECRET: true,
        GOOGLE_CALLBACK_URL: true,
        APPLE_SERVICE_ID: true,
        APPLE_TEAM_ID: true,
        APPLE_KEY_ID: true,
        APPLE_PRIVATE_KEY_OR_PATH: true,
        APPLE_CALLBACK_URL: true,
      },
    });
  });
});
