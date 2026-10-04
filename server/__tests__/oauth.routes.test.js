/** @jest-environment node */
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COOKIE_NAME = process.env.JWT_COOKIE_NAME || 'foria_jwt';
const strategies = {}, store = new Map();
const callbackFlow = jest.fn();
let callbackUser = { id: 123, tokenVersion: 7 };
const startMfaMock = jest.fn(async (_req, res) => res.redirect('/auth/2fa/challenge'));
const authenticateMock = jest.fn(() => (req, res, next) => {
  if (req.path.endsWith('/callback')) {
    callbackFlow(req.oauthFlow);
    req.user = callbackUser;
    return next();
  }
  return res.status(200).end();
});
const client = {
  setEx: jest.fn(async (key, _ttl, value) => store.set(key, value)),
  // Offline Redis double. Production executes the atomic Lua script.
  eval: jest.fn(async (_script, { keys, arguments: args }) => {
    const raw = store.get(keys[0]);
    if (!raw) return null;
    const flow = JSON.parse(raw);
    if (flow.provider !== args[0] || flow.browserHash !== args[1]) return null;
    store.delete(keys[0]);
    return flow.expiresAt > Number(args[2]) ? raw : null;
  }),
};
const ensureRedisMock = jest.fn(async () => client);
const issueSessionMock = jest.fn((res) => {
  res.cookie(COOKIE_NAME, 'mock.jwt.token', { httpOnly: true, path: '/' });
  return 'mock.jwt.token';
});
const exchangeMock = jest.fn(), verifyAppleMock = jest.fn(), resolveUserMock = jest.fn();
let app, keyDir;
function clearOAuthEnv() {
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL',
    'APPLE_CLIENT_ID', 'APPLE_SERVICE_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY', 'APPLE_PRIVATE_KEY_PATH', 'APPLE_CALLBACK_URL']) delete process.env[name];
}
function appleEnv() {
  Object.assign(process.env, { APPLE_CLIENT_ID: 'service.test', APPLE_TEAM_ID: 'team',
    APPLE_KEY_ID: 'key', APPLE_CALLBACK_URL: 'https://api.test/auth/apple/callback',
    APPLE_PRIVATE_KEY_PATH: path.join(keyDir, 'key.p8') });
}
async function startGoogle(query = {}) {
  strategies.google = {};
  const agent = request.agent(app);
  const res = await agent.get('/auth/google').query(query).expect(200);
  return { agent, state: authenticateMock.mock.calls.at(-1)[1].state,
    cookie: res.headers['set-cookie'][0].split(';')[0] };
}
async function startApple(query = {}) {
  appleEnv();
  const agent = request.agent(app);
  const res = await agent.get('/auth/apple').query(query).expect(302);
  const url = new URL(res.headers.location);
  return { agent, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'), url,
    cookie: res.headers['set-cookie'][0].split(';')[0] };
}
beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'http://frontend.test';
  clearOAuthEnv();
  keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatforia-oauth-'));
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  fs.writeFileSync(path.join(keyDir, 'key.p8'), pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  await jest.unstable_mockModule('../auth/passport.js', () => ({ default: {
    _strategy: (name) => strategies[name], authenticate: authenticateMock,
  } }));
  await jest.unstable_mockModule('../utils/redisClient.js', () => ({ ensureRedis: ensureRedisMock }));
  await jest.unstable_mockModule('../routes/auth.js', () => ({ issueSession: issueSessionMock }));
  await jest.unstable_mockModule('axios', () => ({ default: { post: exchangeMock } }));
  await jest.unstable_mockModule('../services/appleTokenVerifier.js', () => ({ verifyAppleIdToken: verifyAppleMock }));
  await jest.unstable_mockModule('../services/oauthIdentity.js', () => ({ resolveOAuthUser: resolveUserMock }));
  await jest.unstable_mockModule(fileURLToPath(new URL('../services/webMfa.js', import.meta.url)), () => ({ startWebMfa: startMfaMock }));
  const { default: router } = await import('../routes/oauth.routes.js');
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', router);
});
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  clearOAuthEnv();
  strategies.google = undefined;
  store.clear();
  callbackUser = { id: 123, tokenVersion: 7 };
  jest.clearAllMocks();
  ensureRedisMock.mockImplementation(async () => client);
  exchangeMock.mockResolvedValue({ data: { id_token: 'verified-test-token' } });
  verifyAppleMock.mockResolvedValue({ sub: 'apple-sub', email: 'apple@example.com', email_verified: true });
  resolveUserMock.mockResolvedValue({ id: 456, tokenVersion: 9 });
});
afterAll(() => {
  process.env.NODE_ENV = 'test';
  clearOAuthEnv();
  if (keyDir) fs.rmSync(keyDir, { recursive: true, force: true });
});
describe('web OAuth state and callbacks', () => {
  test('unconfigured Google start and callback return 501', async () => {
    await request(app).get('/auth/google').expect(501);
    await request(app).get('/auth/google/callback').expect(501);
  });
  test('Google sends opaque state and stores redirect/referral server-side', async () => {
    const { state } = await startGoogle({ next: 'http://frontend.test/complete', ref: 'CREATOR' });
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(authenticateMock).toHaveBeenCalledWith('google', {
      scope: ['profile', 'email'], session: false, state,
    });
    expect(JSON.parse([...store.values()][0])).toMatchObject({
      next: 'http://frontend.test/complete', referralCode: 'CREATOR', provider: 'google',
    });
  });
  test('valid Google callback uses shared session issuance', async () => {
    const { agent, state } = await startGoogle();
    const res = await agent.get('/auth/google/callback').query({ state, code: 'code' }).expect(302);
    expect(res.headers.location).toBe('http://frontend.test');
    expect(res.headers['set-cookie'].find((c) => c.startsWith(`${COOKIE_NAME}=`))).toContain('HttpOnly');
    expect(issueSessionMock).toHaveBeenCalledWith(expect.anything(), { id: 123, tokenVersion: 7 });
    expect(store.size).toBe(0);
  });
  test.each([
    ['http://frontend.test/after', 'http://frontend.test/after'],
    ['https://attacker.example/after', 'http://frontend.test'],
    ['chatforia://oauth/apple', 'http://frontend.test'],
  ])('validates redirect %s', async (next, expected) => {
    const { agent, state } = await startGoogle({ next, ref: 'CREATOR' });
    const res = await agent.get('/auth/google/callback').query({ state }).expect(302);
    expect(res.headers.location).toBe(expected);
    expect(callbackFlow).toHaveBeenCalledWith(expect.objectContaining({ referralCode: 'CREATOR' }));
  });
  test('missing or fabricated state fails before Passport', async () => {
    strategies.google = {};
    await request(app).get('/auth/google/callback').expect(400);
    await request(app).get('/auth/google/callback').query({ state: 'a'.repeat(64) }).expect(400);
    expect(callbackFlow).not.toHaveBeenCalled();
    expect(issueSessionMock).not.toHaveBeenCalled();
  });
  test('different browser cannot consume the original flow', async () => {
    const { agent, state } = await startGoogle();
    await request(app).get('/auth/google/callback').query({ state }).expect(400);
    await agent.get('/auth/google/callback').query({ state }).expect(302);
  });
  test('tampered state does not consume valid state', async () => {
    const { agent, state } = await startGoogle();
    const altered = (state[0] === 'a' ? 'b' : 'a') + state.slice(1);
    await agent.get('/auth/google/callback').query({ state: altered }).expect(400);
    await agent.get('/auth/google/callback').query({ state }).expect(302);
  });
  test('expired state cannot issue a session', async () => {
    const { agent, state } = await startGoogle();
    for (const [key, raw] of store) store.set(key, JSON.stringify({ ...JSON.parse(raw), expiresAt: Date.now() - 1 }));
    await agent.get('/auth/google/callback').query({ state }).expect(400);
    expect(issueSessionMock).not.toHaveBeenCalled();
  });
  test('only one concurrent callback carrying the original cookie succeeds', async () => {
    const { state, cookie } = await startGoogle();
    const responses = await Promise.all([1, 2].map(() => request(app)
      .get('/auth/google/callback').set('Cookie', cookie).query({ state })));
    expect(responses.map((r) => r.status).sort()).toEqual([302, 400]);
    expect(issueSessionMock).toHaveBeenCalledTimes(1);
  });
  test('Redis failure cannot bypass validation', async () => {
    const { agent, state } = await startGoogle();
    ensureRedisMock.mockRejectedValue(new Error('Redis offline'));
    await agent.get('/auth/google/callback').query({ state }).expect(503);
    await request(app).get('/auth/google').expect(503);
    expect(issueSessionMock).not.toHaveBeenCalled();
  });
  test('production state cookie is host-only, Secure, HttpOnly, SameSite=None', async () => {
    process.env.NODE_ENV = 'production';
    strategies.google = {};
    const res = await request(app).get('/auth/google').expect(200);
    const cookie = res.headers['set-cookie'][0];
    for (const value of ['__Host-cf_oauth_google=', 'Secure', 'HttpOnly', 'SameSite=None']) expect(cookie).toContain(value);
    expect(cookie).not.toContain('Domain=');
  });
  test('Apple authorization includes server-generated state and nonce', async () => {
    const { url, state, nonce } = await startApple();
    expect(url.origin).toBe('https://appleid.apple.com');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(nonce).not.toBe(state);
  });
  test('Apple form callback verifies stored nonce and preserves referral', async () => {
    const { agent, state, nonce } = await startApple({ ref: 'CREATOR' });
    await agent.post('/auth/apple/callback').type('form').send({ state, code: 'code' }).expect(302);
    expect(exchangeMock).toHaveBeenCalledTimes(1);
    expect(verifyAppleMock).toHaveBeenCalledWith('verified-test-token', { audience: 'service.test', nonce });
    expect(resolveUserMock).toHaveBeenCalledWith(expect.objectContaining({ referralCode: 'CREATOR' }));
    expect(issueSessionMock).toHaveBeenCalledWith(expect.anything(), { id: 456, tokenVersion: 9 });
  });
  test('invalid Apple nonce/token consumes state without issuing a session', async () => {
    const { state, cookie } = await startApple();
    verifyAppleMock.mockRejectedValue(Object.assign(new Error('bad nonce'), { code: 'invalid_apple_token' }));
    await request(app).post('/auth/apple/callback').set('Cookie', cookie).send({ state, code: 'code' }).expect(401);
    await request(app).post('/auth/apple/callback').set('Cookie', cookie).send({ state, code: 'code' }).expect(400);
    expect(issueSessionMock).not.toHaveBeenCalled();
    expect(resolveUserMock).not.toHaveBeenCalled();
  });
  test('Google state cannot be consumed by Apple', async () => {
    const { agent, state } = await startGoogle();
    appleEnv();
    await agent.get('/auth/apple').expect(302);
    await agent.post('/auth/apple/callback').send({ state, code: 'code' }).expect(400);
    await agent.get('/auth/google/callback').query({ state }).expect(302);
    expect(exchangeMock).not.toHaveBeenCalled();
  });
  test('Apple decline consumes valid state without exchanging a code', async () => {
    const { agent, state } = await startApple();
    await agent.post('/auth/apple/callback').send({ state, error: 'access_denied' }).expect(401);
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  test('missing Apple code returns 400', async () => {
    await request(app).post('/auth/apple/callback').expect(400, { error: 'Missing Apple authorization code' });
  });
  test('failure and debug routes remain available', async () => {
    await request(app).get('/auth/failure').expect(401);
    appleEnv();
    strategies.google = {};
    const res = await request(app).get('/auth/debug').expect(200);
    expect(res.body).toMatchObject({ hasGoogle: true, hasApple: true });
  });
});


test('Google MFA accounts do not receive a session before verification', async () => {
  const { agent, state } = await startGoogle({ next: 'http://frontend.test/after' });
  callbackUser = { id: 123, tokenVersion: 7, twoFactorEnabled: true };
  await agent.get('/auth/google/callback').query({ state }).expect(302);
  expect(issueSessionMock).not.toHaveBeenCalled();
  expect(startMfaMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), callbackUser, 'http://frontend.test/after');
});

test('Apple MFA accounts do not receive a session before verification', async () => {
  const { agent, state } = await startApple({ next: 'http://frontend.test/after' });
  const account = { id: 456, tokenVersion: 9, twoFactorEnabled: true };
  resolveUserMock.mockResolvedValue(account);
  await agent.post('/auth/apple/callback').type('form').send({ state, code: 'apple-code' }).expect(302);
  expect(issueSessionMock).not.toHaveBeenCalled();
  expect(startMfaMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), account, 'http://frontend.test/after');
});
