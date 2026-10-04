import crypto from 'node:crypto';
import prisma from '../utils/prismaClient.js';
import { makeAgent, resetDb } from './helpers/testServer.js';

let agent;
beforeEach(async () => { await resetDb(); ({ agent } = makeAgent()); });
function credentials() {
  const suffix = crypto.randomBytes(5).toString('hex');
  return { username: `signup_${suffix}`, email: `signup_${suffix}@example.com`, password: 'Password!123' };
}

test('signup succeeds without any phone verification and still requires email verification', async () => {
  const response = await agent.post('/auth/register').send(credentials()).expect(201);
  expect(response.body.requiresEmailVerification).toBe(true);
  expect(response.body.token).toBeUndefined();
  const user = await prisma.user.findUnique({ where: { id: response.body.user.id } });
  expect(user.phoneNumber).toBeNull();
  expect(user.phoneVerifiedAt).toBeNull();
  expect(user.emailVerifiedAt).toBeNull();
});

test('legacy phone fields cannot attach a number or mark it verified during signup', async () => {
  const response = await agent.post('/auth/register').send({
    ...credentials(), phone: '+14155550199', smsConsent: true, phoneVerificationId: 'a'.repeat(64),
  }).expect(201);
  const user = await prisma.user.findUnique({ where: { id: response.body.user.id } });
  expect(user.phoneNumber).toBeNull();
  expect(user.phoneVerifiedAt).toBeNull();
  expect(await prisma.phone.findUnique({ where: { number: '+14155550199' } })).toBeNull();
});
