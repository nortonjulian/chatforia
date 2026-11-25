import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import prisma from '../../utils/prismaClient.js';
import {
  activatePushInstallation, registerAuthorizedPush, cleanupPushInstallation,
  authorizedPushRegistrations, revokeAuthenticatedDevice,
  revokePushAuthorityForSession,
} from '../pushAuthorityService.js';

const prefix = crypto.randomUUID().slice(0, 8);
const proof = () => crypto.randomBytes(32).toString('base64url');
const auth = (seed, user, offset = 0) => ({
  pushFingerprint: crypto.createHash('sha256').update(`${seed}:${user.id}`).digest('hex'),
  pushIssuedAtMs: Date.now() + offset,
  pushExpiresAtMs: Date.now() + 86400000,
  tokenVersion: user.tokenVersion,
});

describe('server-verified push installation authority', () => {
  let users;
  let devices;
  let installationId;
  let installationProof;
  beforeAll(async () => {
    users = await Promise.all([0, 1].map((index) => prisma.user.create({
      data: { username: `push_auth_${prefix}_${index}`, passwordHash: 'unusable-test-hash' },
    })));
  });
  beforeEach(async () => {
    const id = crypto.randomUUID().slice(0, 8);
    devices = await Promise.all(users.map((user, index) => prisma.device.create({
      data: { userId: user.id, deviceId: `push-${id}-${index}`, publicKey: 'synthetic-public-key' },
    })));
    installationId = crypto.randomUUID();
    installationProof = proof();
  });
  afterAll(async () => {
    if (users) await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    await prisma.$disconnect();
  });

  const activate = (userIndex, session, id = installationId, secret = installationProof) =>
    activatePushInstallation({ user: users[userIndex], auth: session,
      body: { installationId: id, installationProof: secret,
        deviceId: devices[userIndex].deviceId, platform: 'ios', appId: 'com.chatforia.Chatforia' } });
  const register = (userIndex, session, generation, revision, token, environment = 'production',
    id = installationId, secret = installationProof) =>
    registerAuthorizedPush({ user: users[userIndex], auth: session,
      body: { installationId: id, installationProof: secret, generation,
        provider: 'apns', environment, tokenRevision: revision, token } });
  const rowsFor = async (userIndex, id = installationId) =>
    (await authorizedPushRegistrations(users[userIndex].id))
      .filter((row) => row.installationId === id);

  test('verified session registers, rotates by revision, and rejects stale token', async () => {
    const session = auth('first', users[0]);
    const active = await activate(0, session);
    await register(0, session, active.generation, 1, `prod-${prefix}-a`);
    await register(0, session, active.generation, 2, `prod-${prefix}-b`);
    await expect(register(0, session, active.generation, 1, `prod-${prefix}-a`))
      .rejects.toMatchObject({ code: 'STALE_PUSH_TOKEN' });
    const rows = await rowsFor(0);
    expect(rows.map((row) => row.token)).toEqual([`prod-${prefix}-b`]);
    expect(rows[0].environment).toBe('production');
  });

  test('expiry and account token-version changes fail closed', async () => {
    const session = auth('expiry', users[0]);
    const active = await activate(0, session);
    await register(0, session, active.generation, 1, `expiry-${prefix}`);
    await prisma.pushInstallation.update({ where: { id: installationId },
      data: { sessionExpiresAt: new Date(Date.now() - 1000) } });
    expect(await rowsFor(0)).toHaveLength(0);
    await prisma.pushInstallation.update({ where: { id: installationId },
      data: { sessionExpiresAt: new Date(Date.now() + 3600000) } });
    await prisma.user.update({ where: { id: users[0].id }, data: { tokenVersion: { increment: 1 } } });
    expect(await rowsFor(0)).toHaveLength(0);
    await expect(register(0, session, active.generation, 2, `revoked-${prefix}`))
      .rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
    // Production's staff-security trigger forbids rolling tokenVersion back.
    // Keep later synthetic sessions aligned with the incremented version.
    users[0].tokenVersion += 1;
  });

  test('logout capability is device-scoped and idempotent; old registration cannot return', async () => {
    const otherId = crypto.randomUUID();
    const otherProof = proof();
    const otherDevice = await prisma.device.create({
      data: { userId: users[0].id, deviceId: `push-other-${crypto.randomUUID()}`,
        publicKey: 'synthetic-public-key' },
    });
    const session = auth('logout', users[0]);
    const first = await activate(0, session);
    const second = await activatePushInstallation({ user: users[0], auth: session,
      body: { installationId: otherId, installationProof: otherProof,
        deviceId: otherDevice.deviceId, platform: 'ios', appId: 'com.chatforia.Chatforia' } });
    await register(0, session, first.generation, 1, `logout-${prefix}`);
    await register(0, session, second.generation, 1, `other-${prefix}`, 'production', otherId, otherProof);
    await cleanupPushInstallation({ installationId, generation: first.generation,
      cleanupCapability: first.cleanupCapability });
    await cleanupPushInstallation({ installationId, generation: first.generation,
      cleanupCapability: first.cleanupCapability });
    await expect(register(0, session, first.generation, 2, `late-${prefix}`))
      .rejects.toMatchObject({ code: 'PUSH_AUTHORITY_REVOKED' });
    expect((await rowsFor(0, otherId)).map((row) => row.token))
      .toEqual([`other-${prefix}`]);
  });

  test('account handoff defeats delayed old activation and cleanup', async () => {
    const old = auth('old', users[0], -10000);
    const first = await activate(0, old);
    await register(0, old, first.generation, 1, `switch-${prefix}`);
    const next = auth('new', users[1], 1000);
    const second = await activate(1, next);
    await register(1, next, second.generation, 1, `switch-${prefix}`);
    await cleanupPushInstallation({ installationId, generation: first.generation,
      cleanupCapability: first.cleanupCapability });
    await expect(activate(0, old)).rejects.toMatchObject({ code: 'STALE_PUSH_SESSION' });
    await expect(register(0, old, first.generation, 2, `late-${prefix}`))
      .rejects.toMatchObject({ code: 'PUSH_AUTHORITY_REVOKED' });
    expect(await rowsFor(0)).toHaveLength(0);
    expect((await rowsFor(1)).map((row) => row.token))
      .toEqual([`switch-${prefix}`]);
  });

  test('token transfer between distinct installations fences the prior generation', async () => {
    const oldId = installationId;
    const oldProof = installationProof;
    const newId = crypto.randomUUID();
    const newProof = proof();
    const otherDeviceId = crypto.randomUUID();
    const otherProof = proof();
    const otherDevice = await prisma.device.create({
      data: { userId: users[0].id, deviceId: `push-other-${crypto.randomUUID()}`,
        publicKey: 'synthetic-public-key' },
    });
    const oldSession = auth('transfer-old', users[0], -20000);
    const newSession = auth('transfer-new', users[1], 20000);
    const other = await activatePushInstallation({ user: users[0], auth: oldSession,
      body: { installationId: otherDeviceId, installationProof: otherProof,
        deviceId: otherDevice.deviceId, platform: 'ios', appId: 'com.chatforia.Chatforia' } });
    await register(0, oldSession, other.generation, 1, `independent-${prefix}`,
      'production', otherDeviceId, otherProof);
    const old = await activate(0, oldSession, oldId, oldProof);
    const current = await activate(1, newSession, newId, newProof);
    const token = `transferred-${prefix}`;
    await register(0, oldSession, old.generation, 1, token, 'production', oldId, oldProof);
    await register(1, newSession, current.generation, 1, token, 'production', newId, newProof);
    expect(await rowsFor(0, oldId)).toHaveLength(0);
    expect((await rowsFor(1, newId)).map((row) => row.token)).toEqual([token]);
    await expect(register(0, oldSession, old.generation, 2, token, 'production', oldId, oldProof))
      .rejects.toMatchObject({ code: 'PUSH_AUTHORITY_REVOKED' });
    await expect(activate(0, oldSession, oldId, oldProof))
      .rejects.toMatchObject({ code: 'STALE_PUSH_SESSION' });
    expect((await rowsFor(0, otherDeviceId)).map((row) => row.token))
      .toEqual([`independent-${prefix}`]);
  });

  test('concurrent cross-installation token claims settle on the newer session', async () => {
    const oldId = installationId;
    const oldProof = installationProof;
    const newId = crypto.randomUUID();
    const newProof = proof();
    const oldSession = auth('race-old', users[0], -20000);
    const newSession = auth('race-new', users[1], 20000);
    const old = await activate(0, oldSession, oldId, oldProof);
    const current = await activate(1, newSession, newId, newProof);
    const token = `race-transfer-${prefix}`;
    const results = await Promise.allSettled([
      register(0, oldSession, old.generation, 1, token, 'production', oldId, oldProof),
      register(1, newSession, current.generation, 1, token, 'production', newId, newProof),
    ]);
    expect(results[1].status).toBe('fulfilled');
    expect((await rowsFor(1, newId)).map((row) => row.token)).toEqual([token]);
    expect(await rowsFor(0, oldId)).toHaveLength(0);
    await expect(register(0, oldSession, old.generation, 2, token, 'production', oldId, oldProof))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(PUSH_AUTHORITY_REVOKED|STALE_PUSH_SESSION)$/) });
  });

  test('concurrent duplicate registration leaves one active owner', async () => {
    const session = auth('concurrent', users[0]);
    const active = await activate(0, session);
    const results = await Promise.allSettled([
      register(0, session, active.generation, 1, `concurrent-${prefix}`),
      register(0, session, active.generation, 1, `concurrent-${prefix}`),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await rowsFor(0)).toHaveLength(1);
  });

  test('renewed session keeps same-account tokens but rejects its predecessor', async () => {
    const old = auth('renew-old', users[0], -10000);
    const first = await activate(0, old);
    await register(0, old, first.generation, 1, `renew-${prefix}`);
    const next = auth('renew-new', users[0], 1000);
    const renewed = await activate(0, next);
    expect(Number(renewed.generation)).toBe(Number(first.generation) + 1);
    expect((await rowsFor(0)).map((row) => row.token)).toEqual([`renew-${prefix}`]);
    await expect(register(0, old, first.generation, 2, `old-${prefix}`))
      .rejects.toMatchObject({ code: 'PUSH_AUTHORITY_REVOKED' });
    expect(await revokeAuthenticatedDevice({ user: users[0], auth: old,
      deviceId: devices[0].deviceId })).toEqual({ success: true, stale: true });
    expect((await rowsFor(0)).map((row) => row.token)).toEqual([`renew-${prefix}`]);
  });

  test('current-session logout revokes only its installation and blocks late registration', async () => {
    const session = auth('authenticated-logout', users[0]);
    const active = await activate(0, session);
    await register(0, session, active.generation, 1, `authenticated-logout-${prefix}`);
    expect(await revokeAuthenticatedDevice({ user: users[0], auth: session,
      deviceId: devices[0].deviceId })).toEqual({ success: true, stale: false });
    expect(await revokeAuthenticatedDevice({ user: users[0], auth: session,
      deviceId: devices[0].deviceId })).toEqual({ success: true, stale: false });
    expect(await rowsFor(0)).toHaveLength(0);
    await expect(register(0, session, active.generation, 2, `late-logout-${prefix}`))
      .rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
    await expect(activate(0, session)).rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
    await expect(activate(0, session, crypto.randomUUID(), proof()))
      .rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
  });

  test('auth-only logout revokes one session and preserves another device and session', async () => {
    const firstToken = `synthetic-session-${crypto.randomUUID()}`;
    const secondToken = `synthetic-session-${crypto.randomUUID()}`;
    const firstSession = { ...auth('auth-logout-first', users[0], -10000),
      pushFingerprint: crypto.createHash('sha256').update(firstToken).digest('hex') };
    const secondSession = { ...auth('auth-logout-second', users[0], 10000),
      pushFingerprint: crypto.createHash('sha256').update(secondToken).digest('hex') };
    const secondId = crypto.randomUUID();
    const secondProof = proof();
    const secondDevice = await prisma.device.create({
      data: { userId: users[0].id, deviceId: `push-second-${crypto.randomUUID()}`,
        publicKey: 'synthetic-public-key' },
    });
    const first = await activate(0, firstSession);
    const second = await activatePushInstallation({ user: users[0], auth: secondSession,
      body: { installationId: secondId, installationProof: secondProof,
        deviceId: secondDevice.deviceId, platform: 'ios', appId: 'com.chatforia.Chatforia' } });
    await register(0, firstSession, first.generation, 1, `auth-logout-first-${prefix}`);
    await register(0, secondSession, second.generation, 1, `auth-logout-second-${prefix}`,
      'production', secondId, secondProof);
    const revokedSession = { fingerprint: firstSession.pushFingerprint,
      expiresAt: new Date(firstSession.pushExpiresAtMs) };
    await revokePushAuthorityForSession(revokedSession);
    await revokePushAuthorityForSession(revokedSession);
    expect(await rowsFor(0)).toHaveLength(0);
    await expect(register(0, firstSession, first.generation, 2, `auth-late-${prefix}`))
      .rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
    expect((await rowsFor(0, secondId)).map((row) => row.token))
      .toEqual([`auth-logout-second-${prefix}`]);
  });

  test('retention pruning cannot remove an unexpired session revocation', async () => {
    const session = auth('retention', users[0]);
    await revokePushAuthorityForSession({ fingerprint: session.pushFingerprint,
      expiresAt: new Date(session.pushExpiresAtMs) });
    const [result] = await prisma.$queryRaw`
      SELECT public.prune_expired_push_session_revocations(1000) AS removed`;
    expect(result.removed).toBeGreaterThanOrEqual(0);
    expect(await prisma.pushSessionRevocation.findUnique({
      where: { sessionFingerprint: session.pushFingerprint },
    })).not.toBeNull();
    await expect(activate(0, session)).rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
  });

  test('concurrent logout and registration leave no eligible push grant', async () => {
    const session = auth('logout-race', users[0]);
    const active = await activate(0, session);
    const results = await Promise.allSettled([
      revokePushAuthorityForSession({ fingerprint: session.pushFingerprint,
        expiresAt: new Date(session.pushExpiresAtMs) }),
      register(0, session, active.generation, 1, `logout-race-${prefix}`),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(await rowsFor(0)).toHaveLength(0);
    expect(await prisma.pushSessionRevocation.findUnique({
      where: { sessionFingerprint: session.pushFingerprint },
    })).not.toBeNull();
  });

  test('concurrent logout and new-installation activation cannot restore authority', async () => {
    const session = auth('new-installation-race', users[0]);
    const [logout] = await Promise.allSettled([
      revokePushAuthorityForSession({ fingerprint: session.pushFingerprint,
        expiresAt: new Date(session.pushExpiresAtMs) }),
      activate(0, session, crypto.randomUUID(), proof()),
    ]);
    expect(logout.status).toBe('fulfilled');
    expect(await prisma.pushInstallation.count({ where: {
      sessionFingerprint: session.pushFingerprint, revokedAt: null,
    } })).toBe(0);
    await expect(activate(0, session, crypto.randomUUID(), proof()))
      .rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
  });

  test('provider and environment ownership never alias another grant', async () => {
    const session = auth('environment', users[0]);
    const active = await activate(0, session);
    await register(0, session, active.generation, 1, `apns-prod-${prefix}`);
    await register(0, session, active.generation, 2, `apns-sandbox-${prefix}`, 'sandbox');
    await registerAuthorizedPush({ user: users[0], auth: session,
      body: { installationId, installationProof, generation: active.generation,
        provider: 'apns_voip', environment: 'sandbox', tokenRevision: 1,
        token: `voip-sandbox-${prefix}` } });
    const rows = await rowsFor(0);
    expect(rows.map((row) => [row.provider, row.environment, row.token]).sort()).toEqual([
      ['apns', 'sandbox', `apns-sandbox-${prefix}`],
      ['apns_voip', 'sandbox', `voip-sandbox-${prefix}`],
    ]);
    await expect(cleanupPushInstallation({ installationId, generation: active.generation,
      cleanupCapability: proof() })).rejects.toMatchObject({ code: 'INVALID_CLEANUP_CAPABILITY' });
    expect(await rowsFor(0)).toHaveLength(2);
  });

  test('new registration atomically removes a legacy token mirror on another account', async () => {
    const token = `legacy-transfer-${prefix}-${crypto.randomUUID()}`;
    await prisma.device.update({ where: { id: devices[1].id },
      data: { apnsPushToken: token, pushToken: token, pushProvider: 'apns' } });
    const session = auth('legacy-transfer', users[0]);
    const active = await activate(0, session);
    await register(0, session, active.generation, 1, token);
    const old = await prisma.device.findUnique({ where: { id: devices[1].id } });
    expect(old.apnsPushToken).toBeNull();
    expect(old.pushToken).toBeNull();
    expect((await rowsFor(0)).map((row) => row.token)).toEqual([token]);
    expect(await rowsFor(1)).toHaveLength(0);
  });

  test('a replacement installation retires old authority on the same device', async () => {
    const oldSession = auth('old-installation', users[0], -10000);
    const first = await activate(0, oldSession);
    await register(0, oldSession, first.generation, 1, `old-installation-${prefix}`);
    const nextId = crypto.randomUUID();
    const nextProof = proof();
    const nextSession = auth('new-installation', users[0], 1000);
    const next = await activate(0, nextSession, nextId, nextProof);
    await register(0, nextSession, next.generation, 1, `new-installation-${prefix}`,
      'production', nextId, nextProof);
    expect(await rowsFor(0)).toHaveLength(0);
    expect((await rowsFor(0, nextId)).map((row) => row.token))
      .toEqual([`new-installation-${prefix}`]);
    await expect(activate(0, oldSession)).rejects.toMatchObject({ code: 'STALE_PUSH_SESSION' });
  });

  test('Android FCM registration is separate from APNs environments', async () => {
    const session = auth('android', users[0]);
    const active = await activatePushInstallation({ user: users[0], auth: session,
      body: { installationId, installationProof, deviceId: devices[0].deviceId,
        platform: 'android', appId: 'com.chatforia.android' } });
    await registerAuthorizedPush({ user: users[0], auth: session,
      body: { installationId, installationProof, generation: active.generation,
        provider: 'fcm', environment: 'none', tokenRevision: 1,
        token: `fcm-${prefix}` } });
    expect((await rowsFor(0)).map((row) => [row.provider, row.environment, row.token]))
      .toEqual([['fcm', 'none', `fcm-${prefix}`]]);
    await expect(registerAuthorizedPush({ user: users[0], auth: session,
      body: { installationId, installationProof, generation: active.generation,
        provider: 'apns', environment: 'production', tokenRevision: 2,
        token: `wrong-provider-${prefix}` } }))
      .rejects.toMatchObject({ code: 'PROVIDER_PLATFORM_MISMATCH' });
  });

  test('expired request cannot activate an installation', async () => {
    const session = auth('invalid', users[0]);
    session.pushExpiresAtMs = Date.now() - 1;
    await expect(activate(0, session)).rejects.toMatchObject({ code: 'PUSH_SESSION_UNAVAILABLE' });
  });
});
