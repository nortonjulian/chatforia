/** @jest-environment node */
import { jest } from '@jest/globals';
import { ensureRedis } from '../utils/redisClient.js';
import { redis, __resetRedisMock } from './mocks/redisClient.dynamic.js';
import { webOAuthState } from '../services/webOAuthState.js';

function browser() {
  const req = { cookies: {}, secure: false };
  const res = {
    cookie: jest.fn((name, value) => { req.cookies[name] = value; }),
    clearCookie: jest.fn(),
  };
  return { req, res };
}
beforeEach(() => __resetRedisMock());
afterEach(() => jest.restoreAllMocks());

describe('OAuth state with the configured Jest Redis mock', () => {
  test('ensureRedis returns the shared client and key/value TTL is enforced', async () => {
    let clock = 100000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    expect(await ensureRedis()).toBe(redis);
    await redis.setEx('ttl', 10, 'value');
    expect(await redis.get('ttl')).toBe('value');
    clock += 10000;
    expect(await redis.get('ttl')).toBeNull();
  });
  test('the default OAuth service loads through moduleNameMapper and consumes once', async () => {
    const { req, res } = browser();
    const { state, nonce } = await webOAuthState.begin(req, res, {
      provider: 'apple', next: 'http://frontend.test', referralCode: 'CREATOR',
    });
    await expect(webOAuthState.consume(req, res, 'apple', state))
      .resolves.toMatchObject({ provider: 'apple', nonce, referralCode: 'CREATOR' });
    await expect(webOAuthState.consume(req, res, 'apple', state))
      .rejects.toMatchObject({ code: 'invalid_oauth_state' });
  });
  test('a wrong browser cannot remove the valid transaction', async () => {
    const { req, res } = browser();
    const { state } = await webOAuthState.begin(req, res, { provider: 'google', next: '/' });
    const name = Object.keys(req.cookies)[0];
    const wrong = { ...req, cookies: { [name]: 'a'.repeat(64) } };
    await expect(webOAuthState.consume(wrong, res, 'google', state))
      .rejects.toMatchObject({ code: 'invalid_oauth_state' });
    await expect(webOAuthState.consume(req, res, 'google', state))
      .resolves.toMatchObject({ provider: 'google' });
  });
  test('parallel consumers get one winner', async () => {
    const { req, res } = browser();
    const { state } = await webOAuthState.begin(req, res, { provider: 'google', next: '/' });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
      webOAuthState.consume(req, res, 'google', state)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
  });
  test('reset hook clears string transactions as well as existing list/hash stores', async () => {
    await redis.setEx('state', 600, '{}');
    await redis.rPush('queue', 'user');
    await redis.hSet('pair', { user: '1' });
    __resetRedisMock();
    expect(await redis.get('state')).toBeNull();
    expect(await redis.lRange('queue', 0, -1)).toEqual([]);
    expect(await redis.hGetAll('pair')).toEqual({});
  });
});
