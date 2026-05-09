/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'foria_jwt';

const strategies = {};

const authenticateMock = jest.fn((_strategyName, _options) => {
  return (req, res, next) => {
    req.user = { id: 123 };

    if (req.path.endsWith('/callback')) {
      return next();
    }

    return res.status(200).end();
  };
});

let app;
let jwt;
let oauthRouter;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.FRONTEND_URL = 'http://frontend.test';
  delete process.env.COOKIE_DOMAIN;

  await jest.unstable_mockModule('../auth/passport.js', () => ({
    default: {
      _strategy: jest.fn((name) => strategies[name]),
      authenticate: authenticateMock,
    },
  }));

  const jwtModule = await import('jsonwebtoken');
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

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CALLBACK_URL;
  delete process.env.APPLE_SERVICE_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;
  delete process.env.APPLE_PRIVATE_KEY_PATH;
  delete process.env.APPLE_CALLBACK_URL;
});

describe('oauth.routes', () => {
  test('GET /auth/google returns 501 when Google strategy is not configured', async () => {
    strategies.google = undefined;

    const res = await request(app).get('/auth/google');

    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ error: 'Google OAuth not configured' });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  test('GET /auth/google calls passport.authenticate with correct options', async () => {
    strategies.google = {};

    const state = 'some-state-value';

    const res = await request(app)
      .get('/auth/google')
      .query({ state });

    expect(authenticateMock).toHaveBeenCalledWith('google', {
      scope: ['profile', 'email'],
      session: false,
      state,
    });

    expect(res.statusCode).toBe(200);
  });

  test('GET /auth/google/callback sets session cookie and redirects to FRONTEND_URL by default', async () => {
    strategies.google = {};

    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const res = await request(app).get('/auth/google/callback');

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://frontend.test');

    const cookies = res.headers['set-cookie'];

    expect(cookies).toBeDefined();
    expect(cookies[0]).toMatch(new RegExp(`${COOKIE_NAME}=mock\\.jwt\\.token`));
    expect(cookies[0]).toMatch(/HttpOnly/);
    expect(cookies[0]).not.toMatch(/Secure/);

    expect(signSpy).toHaveBeenCalledWith(
      {
        id: 123,
        email: null,
        username: null,
        role: 'USER',
        plan: 'FREE',
      },
      'test-secret',
      { expiresIn: '30d' }
    );
  });

  test('GET /auth/google/callback uses state.next redirect when valid and allowed', async () => {
    strategies.google = {};

    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const nextUrl = 'http://frontend.test/after/login';
    const encodedState = Buffer.from(
      JSON.stringify({ next: nextUrl }),
      'utf8'
    ).toString('base64');

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ state: encodedState });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(nextUrl);
    expect(signSpy).toHaveBeenCalled();
  });

  test('GET /auth/google/callback falls back to FRONTEND_URL when state.next is not allowed', async () => {
    strategies.google = {};

    jest.spyOn(jwt, 'sign').mockReturnValue('mock.jwt.token');

    const encodedState = Buffer.from(
      JSON.stringify({ next: 'https://example.com/after/login' }),
      'utf8'
    ).toString('base64');

    const res = await request(app)
      .get('/auth/google/callback')
      .query({ state: encodedState });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://frontend.test');
  });

  test('GET /auth/google/callback returns 501 when Google strategy is missing', async () => {
    strategies.google = undefined;

    const res = await request(app).get('/auth/google/callback');

    expect(res.statusCode).toBe(501);
    expect(res.body).toEqual({ error: 'Google OAuth not configured' });
  });

  test('GET /auth/apple redirects to Apple authorize URL', async () => {
    process.env.APPLE_SERVICE_ID = 'service.test';
    process.env.APPLE_CALLBACK_URL = 'http://localhost:4000/auth/apple/callback';

    const res = await request(app)
      .get('/auth/apple')
      .query({ next: 'http://frontend.test/apple-after' });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain(
      'https://appleid.apple.com/auth/authorize'
    );
    expect(res.headers.location).toContain('client_id=service.test');
    expect(res.headers.location).toContain(
      encodeURIComponent('http://localhost:4000/auth/apple/callback')
    );
    expect(res.headers.location).toContain('response_type=code');
    expect(res.headers.location).toContain('response_mode=form_post');
  });

  test('POST /auth/apple/callback returns 400 when code is missing', async () => {
    const res = await request(app).post('/auth/apple/callback');

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing Apple authorization code' });
  });

  test('GET /auth/failure returns 401', async () => {
    const res = await request(app).get('/auth/failure');

    expect(res.statusCode).toBe(401);
    expect(res.text).toBe('SSO failed');
  });

  test('GET /auth/debug reports strategies and envSeen flags', async () => {
    strategies.google = {};

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
      hasAppleEnv: true,
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