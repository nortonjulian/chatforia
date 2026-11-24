/** Auth reset integration: registration, verification, password change. */
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';
import prisma from '../utils/prismaClient.js';
import { makeAgent, resetDb } from './helpers/testServer.js';
import { activatePushInstallation, registerAuthorizedPush } from '../services/pushAuthorityService.js';

describe('Auth flows', () => {
  let agent;
  let email;
  let username;
  const password = 'StartPass123!';
  const newPassword = 'NewPass123!';

  beforeEach(async () => {
    await resetDb();
    ({ agent } = makeAgent());
    username = `pw_${crypto.randomBytes(6).toString('hex')}`;
    email = `${username}@example.com`;
  });

  it('password reset flow (request → reset → login works)', async () => {
    const registered = await agent.post('/auth/register')
      .send({ email, username, password }).expect(201);
    const id = registered.body.user.id;
    const created = await prisma.user.findUnique({ where: { id } });
    expect(created.usernameNorm).toBe(username.toLowerCase());
    expect(created.emailNorm).toBe(email.toLowerCase());

    await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    await agent.post('/auth/login').send({ email, password }).expect(200);
    const fp = await agent.post('/auth/forgot-password').send({ email }).expect(200);
    expect(fp.body.token).toMatch(/^[a-f0-9]{64}$/);
    await agent.post('/auth/reset-password')
      .send({ token: fp.body.token, newPassword }).expect(200);
    await agent.post('/auth/login').send({ email, password: newPassword }).expect(200);
    await agent.post('/auth/login').send({ email, password }).expect(401);
    await agent.post('/auth/reset-password')
      .send({ token: fp.body.token, newPassword: 'AnotherPass!9' }).expect(400);
  });

  it('returns accessibility and discoverability preferences from GET /auth/me', async () => {
    const registered = await agent.post('/auth/register')
      .send({ email, username, password }).expect(201);
    const id = registered.body.user.id;

    await prisma.user.update({
      where: { id },
      data: {
        emailVerifiedAt: new Date(),
        a11yUiFont: 'lg',
        a11yVisualAlerts: true,
        a11yLiveCaptions: false,
        a11yVoiceNoteSTT: true,
        a11yCaptionFont: 'sm',
        a11yCaptionBg: 'transparent',
      },
    });

    await agent.post('/auth/login')
      .send({ email, password })
      .expect(200);

    const saved = await agent.patch('/users/me')
      .send({ discoverability: 'NO_ONE' }).expect(200);
    expect(saved.body.discoverability).toBe('NO_ONE');

    const me = await agent.get('/auth/me').expect(200);

    expect(me.body.user).toMatchObject({
      discoverability: 'NO_ONE',
      twoFactorEnabled: false,
      a11yUiFont: 'lg',
      a11yVisualAlerts: true,
      a11yLiveCaptions: false,
      a11yVoiceNoteSTT: true,
      a11yCaptionFont: 'sm',
      a11yCaptionBg: 'transparent',
    });

    expect(me.body.user).not.toHaveProperty('totpSecretEnc');
    expect(me.body.user).not.toHaveProperty('twoFactorRecoveryCodes');
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects case-insensitive duplicate registration and wrong passwords', async () => {
    const registered = await agent.post('/auth/register')
      .send({ email, username, password }).expect(201);
    const id = registered.body.user.id;
    await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
    await agent.post('/auth/register')
      .send({ email: email.toUpperCase(), username: `alt_${crypto.randomBytes(5).toString('hex')}`, password }).expect(409);
    await agent.post('/auth/register')
      .send({ email: `other_${email}`, username: username.toUpperCase(), password }).expect(409);
    await agent.post('/auth/login')
      .send({ identifier: username.toUpperCase(), password }).expect(200);
    await agent.post('/auth/login').send({ email, password: 'WrongPass!9' }).expect(401);
    await agent.post('/auth/login')
      .send({ identifier: `unknown_${crypto.randomBytes(4).toString('hex')}`, password }).expect(401);
    expect(await prisma.user.count()).toBe(1);
  });

  it('returns enabled MFA status after verified enrollment', async () => {
    const registered = await agent.post('/auth/register')
      .send({ email, username, password }).expect(201);

    const id = registered.body.user.id;

    await prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date() },
    });

    await agent.post('/auth/login')
      .send({ email, password })
      .expect(200);

    const setup = await agent.post('/auth/2fa/setup')
      .send({})
      .expect(200);

    expect(setup.body.ok).toBe(true);

    const code = speakeasy.totp({
      secret: setup.body.tmpSecret,
      encoding: 'base32',
    });

    const enabled = await agent.post('/auth/2fa/enable')
      .send({
        tmpSecret: setup.body.tmpSecret,
        code,
      })
      .expect(200);

    expect(enabled.body.ok).toBe(true);
    expect(enabled.body.backupCodes).toHaveLength(10);

    const me = await agent.get('/auth/me').expect(200);

    expect(me.body.user.twoFactorEnabled).toBe(true);
    expect(me.body.user).not.toHaveProperty('totpSecretEnc');
    expect(me.body.user).not.toHaveProperty('twoFactorRecoveryCodes');
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('auth-only logout revokes its push grant while another session stays authorized', async () => {
    const registered = await agent.post('/auth/register')
      .send({ email, username, password }).expect(201);
    const userId = registered.body.user.id;
    await prisma.user.update({ where: { id: userId },
      data: { emailVerifiedAt: new Date() } });
    const otherAgent = makeAgent().agent;
    const firstToken = (await agent.post('/auth/login')
      .send({ email, password }).expect(200)).body.token;
    const secondToken = (await otherAgent.post('/auth/login')
      .send({ email, password }).expect(200)).body.token;
    for (const token of [firstToken, secondToken]) {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      expect(claims.issuedAtMs).toBeGreaterThan(0);
      expect(Number.isSafeInteger(claims.issuedAtMs)).toBe(true);
      expect(Number.isSafeInteger(claims.exp)).toBe(true);
      expect(claims.exp * 1000).toBeGreaterThan(Date.now());
    }
    const api = makeAgent().agent;

    const install = async (suffix, token) => {
      const deviceId = `push-auth-logout-${suffix}`;
      const installationId = crypto.randomUUID();
      const installationProof = crypto.randomBytes(32).toString('base64url');
      await prisma.device.create({ data: { userId, deviceId,
        publicKey: 'synthetic-public-key' } });
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
      const session = {
        pushFingerprint: crypto.createHash('sha256').update(token).digest('hex'),
        pushIssuedAtMs: claims.issuedAtMs,
        pushExpiresAtMs: claims.exp * 1000,
        tokenVersion: claims.tokenVersion,
      };
      const user = { id: userId };
      const body = {
        installationId, installationProof, deviceId,
        platform: 'ios', appId: 'com.chatforia.Chatforia',
      };
      const active = await activatePushInstallation({ user, auth: session, body });
      await registerAuthorizedPush({ user, auth: session, body: {
        installationId, installationProof, generation: active.generation,
        provider: 'apns', environment: 'production',
        tokenRevision: 1, token: `synthetic-push-${suffix}`,
      } });
      return { user, session, body, generation: active.generation };
    };
    const first = await install('first', firstToken);
    const second = await install('second', secondToken);
    expect(await prisma.pushRegistration.count({ where: { revokedAt: null } })).toBe(2);

    await api.post('/auth/logout').set('Authorization', `Bearer ${firstToken}`).expect(200);
    await api.post('/auth/logout').set('Authorization', `Bearer ${firstToken}`).expect(200);
    expect(await prisma.pushRegistration.count({ where: { revokedAt: null } })).toBe(1);
    await expect(registerAuthorizedPush({ user: first.user, auth: first.session, body: {
      installationId: first.body.installationId,
      installationProof: first.body.installationProof, generation: first.generation,
      provider: 'apns', environment: 'production', tokenRevision: 2,
      token: 'synthetic-push-late',
    } })).rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
    await expect(activatePushInstallation({ user: first.user, auth: first.session,
      body: { ...first.body, installationId: crypto.randomUUID(),
        installationProof: crypto.randomBytes(32).toString('base64url') },
    })).rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
    await api.get('/auth/logout')
      .set('Cookie', `${process.env.JWT_COOKIE_NAME || 'foria_jwt'}=${secondToken}`)
      .expect(302);
    expect(await prisma.pushRegistration.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('logout before installation activation fences a delayed new installation', async () => {
    const registered = await agent.post('/auth/register')
      .send({ email, username, password }).expect(201);
    const userId = registered.body.user.id;
    await prisma.user.update({ where: { id: userId },
      data: { emailVerifiedAt: new Date() } });
    const token = (await agent.post('/auth/login')
      .send({ email, password }).expect(200)).body.token;
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    const session = {
      pushFingerprint: crypto.createHash('sha256').update(token).digest('hex'),
      pushIssuedAtMs: claims.issuedAtMs,
      pushExpiresAtMs: claims.exp * 1000,
      tokenVersion: claims.tokenVersion,
    };
    const deviceId = `push-auth-before-${crypto.randomUUID()}`;
    await prisma.device.create({ data: { userId, deviceId,
      publicKey: 'synthetic-public-key' } });
    await makeAgent().agent.post('/auth/logout')
      .set('Authorization', `Bearer ${token}`).expect(200);
    await expect(activatePushInstallation({ user: { id: userId }, auth: session,
      body: { installationId: crypto.randomUUID(),
        installationProof: crypto.randomBytes(32).toString('base64url'),
        deviceId, platform: 'ios', appId: 'com.chatforia.Chatforia' },
    })).rejects.toMatchObject({ code: 'PUSH_SESSION_REVOKED' });
  });
});
