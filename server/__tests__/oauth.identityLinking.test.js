import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';
import { resetDb } from './helpers/testServer.js';
import { resolveOAuthUser } from '../services/oauthIdentity.js';

const email = 'oauth_link@example.com';
const subject = 'oauth-link-subject';

async function createUser(data = {}) {
  return prisma.user.create({
    data: {
      username: `oa_${crypto.randomBytes(6).toString('hex')}`,
      email,
      passwordHash: 'oauth',
      ...data,
    },
  });
}

function resolve(overrides = {}) {
  return resolveOAuthUser({
    provider: 'google', providerSub: subject, email,
    emailVerified: true, ...overrides,
  });
}

describe('OAuth identity linking', () => {
  beforeEach(async () => { await resetDb(); });

  test('links a single case-insensitive email match and stores its normalization', async () => {
    const existing = await createUser({ email: email.toUpperCase() });
    const user = await resolve();
    expect(user.id).toBe(existing.id);
    expect(user.googleSub).toBe(subject);
    expect(user.emailNorm).toBe(email);
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  test('does not link an unverified provider email', async () => {
    const existing = await createUser();
    await expect(resolve({ emailVerified: false })).rejects.toMatchObject({ code: 'oauth_provider_conflict' });
    const after = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(after.googleSub).toBeNull();
    expect(after.emailVerifiedAt).toBeNull();
  });

  test('does not replace an existing provider subject', async () => {
    const existing = await createUser({ googleSub: 'original-subject' });
    await expect(resolve()).rejects.toMatchObject({ code: 'oauth_provider_conflict' });
    const after = await prisma.user.findUnique({ where: { id: existing.id } });
    expect(after.googleSub).toBe('original-subject');
  });

  test('rejects ambiguous legacy email matches', async () => {
    await createUser();
    await createUser({ email: email.toUpperCase() });
    await expect(resolve()).rejects.toMatchObject({ code: 'oauth_provider_conflict' });
    expect(await prisma.user.count({ where: { googleSub: subject } })).toBe(0);
  });

  test('a matched provider cannot verify a different stored email', async () => {
    const existing = await createUser({ googleSub: subject, email: 'stored@example.com' });
    const user = await resolve();
    expect(user.id).toBe(existing.id);
    expect(user.email).toBe('stored@example.com');
    expect(user.emailVerifiedAt).toBeNull();
  });

  test.each([{ isBanned: true }, { deletedAt: new Date() }])(
    'rejects an unavailable account by subject and by email: %o', async (flags) => {
      await createUser({ googleSub: subject, ...flags });
      await expect(resolve()).rejects.toMatchObject({ code: 'oauth_provider_conflict' });
      await expect(resolve({ providerSub: 'another-subject' })).rejects.toMatchObject({ code: 'oauth_provider_conflict' });
    }
  );

  test('new OAuth users have normalized identities and valid pending usernames', async () => {
    const user = await resolve();
    expect(user.username.length).toBeLessThanOrEqual(20);
    expect(user.usernameNorm).toBe(user.username.toLowerCase());
    expect(user.emailNorm).toBe(email);
    expect(user.emailVerifiedAt).not.toBeNull();
  });
});
