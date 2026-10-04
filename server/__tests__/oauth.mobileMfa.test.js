/** @jest-environment node */
import { jest } from '@jest/globals';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
process.env.GOOGLE_CLIENT_ID = 'google-test';
const issueSession = jest.fn(() => 'session-token');
const resolveUser = jest.fn();
const createChallenge = jest.fn(async () => 'short-mfa-challenge');
await jest.unstable_mockModule('google-auth-library', () => ({ OAuth2Client: class {
  async verifyIdToken() { return { getPayload: () => ({ sub: 'google-user', email_verified: true }) }; }
} }));
for (const [path, exports] of [
  ['../routes/auth.js', { issueSession }],
  ['../services/oauthIdentity.js', { resolveOAuthUser: resolveUser }],
  ['../services/mfaLogin.js', { createMfaChallenge: createChallenge }],
  ['../services/appleTokenVerifier.js', { verifyAppleIdToken: async () => ({ sub: 'apple-user' }) }],
]) await jest.unstable_mockModule(fileURLToPath(new URL(path, import.meta.url)), () => exports);
const { default: router } = await import('../routes/oauth.mobile.js');
const app = express(); app.use(express.json()); app.use('/auth/oauth', router);
beforeEach(() => { jest.clearAllMocks(); });

test.each([
  ['/google/ios', { idToken: 'verified-token' }],
  ['/google/android', { idToken: 'verified-token' }],
  ['/apple/ios', { identityToken: 'verified-token' }],
])('%s cannot bypass enabled MFA', async (path, body) => {
  resolveUser.mockResolvedValue({ id: 7, twoFactorEnabled: true });
  const response = await request(app).post(`/auth/oauth${path}`).send(body).expect(200);
  expect(response.body).toEqual({ message: 'mfa_required', mfaRequired: true, mfaToken: 'short-mfa-challenge' });
  expect(response.body.token).toBeUndefined();
  expect(issueSession).not.toHaveBeenCalled();
});

test('accounts without MFA keep the normal mobile login response', async () => {
  resolveUser.mockResolvedValue({ id: 7, twoFactorEnabled: false });
  const response = await request(app).post('/auth/oauth/google/ios').send({ idToken: 'verified-token' }).expect(200);
  expect(response.body.token).toBe('session-token');
  expect(createChallenge).not.toHaveBeenCalled();
});
