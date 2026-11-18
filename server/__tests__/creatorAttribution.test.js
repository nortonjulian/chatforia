import { creatorAttributionFields } from '../services/creatorAttribution.js';
import { resolveOAuthUser } from '../services/oauthIdentity.js';
import prisma from '../utils/prismaClient.js';
import { makeAgent, resetDb } from './helpers/testServer.js';

const previousCodes = process.env.CREATOR_PILOT_CODES;
beforeEach(async () => {
  process.env.CREATOR_PILOT_CODES = 'PILOT_1,PILOT_2';
  await resetDb();
});
afterAll(() => {
  if (previousCodes === undefined) delete process.env.CREATOR_PILOT_CODES;
  else process.env.CREATOR_PILOT_CODES = previousCodes;
});
test.each([null, {}, '<script>', 'UNKNOWN', 'A'.repeat(41)])('ignores unapproved/invalid code %p', code => {
  expect(creatorAttributionFields(code, 'web-google')).toEqual({});
});
test('empty pilot list disables attribution', () => {
  process.env.CREATOR_PILOT_CODES = '';
  expect(creatorAttributionFields('PILOT_1', 'web-google')).toEqual({});
});
test('ordinary registration persists approved attribution but never grants Premium', async () => {
  const { agent } = makeAgent();
  const response = await agent.post('/auth/register').send({
    username: 'creator_signup', email: 'signup@example.com', password: 'TestPass123!', referralCode: ' pilot_1 ',
  }).expect(201);
  const user = await prisma.user.findUnique({where: {id: response.body.user.id}});
  expect(user).toMatchObject({creatorReferralCode: 'PILOT_1', creatorReferralSource: 'registration', plan: 'FREE'});
  expect(user.creatorReferredAt).toBeInstanceOf(Date);
});
test('unknown referral does not block registration', async () => {
  const { agent } = makeAgent();
  const response = await agent.post('/auth/register').send({
    username: 'unknown_signup', email: 'unknown@example.com', password: 'TestPass123!', referralCode: { bad: true },
  }).expect(201);
  const user = await prisma.user.findUnique({where: {id: response.body.user.id}});
  expect(user.creatorReferralCode).toBeNull();
});
test.each(['google', 'apple'])('new %s signup is attributed; subsequent login cannot replace it', async provider => {
  const input = { provider, providerSub: 'creator-sub', email: 'oauth@example.com', emailVerified: true,
    referralCode: 'pilot_1', referralSource: `web-${provider}` };
  const first = await resolveOAuthUser(input);
  expect(first.creatorReferralCode).toBe('PILOT_1');
  const again = await resolveOAuthUser({...input, referralCode: 'PILOT_2'});
  expect(again.id).toBe(first.id);
  expect(again.creatorReferralCode).toBe('PILOT_1');
  expect(again.creatorReferredAt).toEqual(first.creatorReferredAt);
});
test('linking OAuth to an existing password account never attributes it retroactively', async () => {
  const existing = await prisma.user.create({data: {username: 'existing', email: 'existing@example.com', passwordHash: 'unused'}});
  const linked = await resolveOAuthUser({provider: 'google', providerSub: 'new-sub', email: existing.email,
    emailVerified: true, referralCode: 'PILOT_1', referralSource: 'web-google'});
  expect(linked.id).toBe(existing.id);
  expect(linked.creatorReferralCode).toBeNull();
});
