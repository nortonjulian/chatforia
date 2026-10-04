/** Auth reset integration: registration, verification, password change. */
import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';
import { makeAgent, resetDb } from './helpers/testServer.js';

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
});
