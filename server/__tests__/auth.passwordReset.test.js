/** @jest-environment node */
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import prisma from '../utils/prismaClient.js';
import { hashToken, consumeResetToken } from '../utils/resetTokens.js';
import { makeAgent, resetDb } from './helpers/testServer.js';

describe('password reset (persistent tokens)', () => {
  let agent;
  let email;
  let userId;
  const startPass = 'Password!23';
  const newPass = 'NewPw!456';

  beforeEach(async () => {
    await resetDb();
    ({ agent } = makeAgent());
    const username = `rst_${crypto.randomBytes(6).toString('hex')}`;
    email = `${username}@example.com`;
    const registered = await agent.post('/auth/register')
      .send({ email, username, password: startPass }).expect(201);
    userId = registered.body.user.id;
    await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  });

  async function requestToken() {
    const fp = await agent.post('/auth/forgot-password').send({ email }).expect(200);
    expect(fp.body.token).toMatch(/^[a-f0-9]{64}$/);
    return fp.body.token;
  }

  test('reset-password consumes token and updates password', async () => {
    const before = await prisma.user.findUnique({ where: { id: userId } });
    const token = await requestToken();
    const tokenHash = hashToken(token);
    const stored = await prisma.passwordResetToken.findFirst({ where: { userId, tokenHash } });
    expect(stored).not.toBeNull();
    expect(stored.usedAt).toBeNull();
    await agent.post('/auth/reset-password').send({ token, newPassword: newPass }).expect(200);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(await bcrypt.compare(newPass, after.passwordHash)).toBe(true);
    expect(await bcrypt.compare(startPass, after.passwordHash)).toBe(false);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    const consumed = await prisma.passwordResetToken.findUnique({ where: { id: stored.id } });
    expect(consumed.usedAt).not.toBeNull();
    await agent.post('/auth/reset-password')
      .send({ token, newPassword: 'AnotherPass!9' }).expect(400);
    await agent.post('/auth/login').send({ identifier: email, password: newPass }).expect(200);
    await agent.post('/auth/login').send({ identifier: email, password: startPass }).expect(401);
  });

  test('invalid and expired tokens do not change the password', async () => {
    const before = await prisma.user.findUnique({ where: { id: userId } });
    await agent.post('/auth/reset-password')
      .send({ token: 'invalid_token', newPassword: newPass }).expect(400);
    const token = await requestToken();
    const result = await prisma.passwordResetToken.updateMany({
      where: { userId, tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(result.count).toBe(1);
    await agent.post('/auth/reset-password').send({ token, newPassword: newPass }).expect(400);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    await agent.post('/auth/login').send({ identifier: email, password: startPass }).expect(200);
  });

  test('concurrent resets accept one winner and revoke sessions once', async () => {
    const before = await prisma.user.findUnique({ where: { id: userId } });
    const token = await requestToken();
    const passwords = ['WinnerOne!123', 'WinnerTwo!456'];
    const results = await Promise.all(passwords.map((newPassword) =>
      makeAgent().agent.post('/auth/reset-password').send({ token, newPassword })
    ));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = results.findIndex((r) => r.status === 200);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expect(await bcrypt.compare(passwords[winner], after.passwordHash)).toBe(true);
    expect(await bcrypt.compare(passwords[1 - winner], after.passwordHash)).toBe(false);
  });

  test.each(['isBanned', 'deletedAt'])('%s account cannot use a previously issued reset', async (field) => {
    const token = await requestToken();
    const before = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.user.update({
      where: { id: userId },
      data: { [field]: field === 'isBanned' ? true : new Date() },
    });
    await agent.post('/auth/reset-password').send({ token, newPassword: newPass }).expect(400);
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    const response = await agent.post('/auth/forgot-password').send({ email }).expect(200);
    expect(response.body.token).toBeUndefined();
  });

  test('a newer reset link invalidates the previous link', async () => {
    const previous = await requestToken();
    const current = await requestToken();
    await agent.post('/auth/reset-password').send({ token: previous, newPassword: newPass }).expect(400);
    await agent.post('/auth/reset-password').send({ token: current, newPassword: newPass }).expect(200);
  });

  test('unknown recovery identities do not create accounts or expose dummy tokens', async () => {
    const unknown = `unknown_${crypto.randomBytes(6).toString('hex')}@example.com`;
    const response = await agent.post('/auth/forgot-password').send({ email: unknown }).expect(200);
    expect(response.body.token).toBeUndefined();
    expect(await prisma.user.count({ where: { email: unknown } })).toBe(0);
  });


  test('a failed password transaction rolls back the token claim', async () => {
    const token = await requestToken();
    await expect(prisma.$transaction(async (tx) => {
      expect(await consumeResetToken(token, tx)).toBe(userId);
      throw new Error('simulated password write failure');
    })).rejects.toThrow('simulated password write failure');
    const stored = await prisma.passwordResetToken.findFirst({
      where: { userId, tokenHash: hashToken(token) },
    });
    expect(stored.usedAt).toBeNull();
    await agent.post('/auth/reset-password').send({ token, newPassword: newPass }).expect(200);
  });

  test('concurrent reset-link requests leave only one usable link', async () => {
    const results = await Promise.all([0, 1].map(() =>
      makeAgent().agent.post('/auth/forgot-password').send({ email })
    ));
    results.forEach((r) => {
      expect(r.status).toBe(200);
      expect(r.body.token).toMatch(/^[a-f0-9]{64}$/);
    });
    expect(await prisma.passwordResetToken.count({ where: { userId, usedAt: null } })).toBe(1);
    const resets = await Promise.all(results.map((r) =>
      makeAgent().agent.post('/auth/reset-password').send({ token: r.body.token, newPassword: newPass })
    ));
    expect(resets.map((r) => r.status).sort()).toEqual([200, 400]);
  });

});
