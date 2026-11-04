import { jest } from '@jest/globals';

import { assertStaffRuntimeReady } from '../staffRuntimeReadiness.js';
const env = {
  STAFF_SECURITY_ENABLED: 'true',
  STAFF_ACCESS_SIGNING_SECRET: 's'.repeat(32),
  JWT_SECRET: 'j'.repeat(32),
  APP_ENC_KEY: Buffer.alloc(32).toString('base64'),
};
test('disabled rollout performs no database query', async () => {
  const db = { $queryRaw: jest.fn() };
  await assertStaffRuntimeReady(db, {});
  expect(db.$queryRaw).not.toHaveBeenCalled();
});
test.each([
  { STAFF_ACCESS_SIGNING_SECRET: '' },
  { JWT_SECRET: 'short' },
  { JWT_SECRET: env.STAFF_ACCESS_SIGNING_SECRET },
  { APP_ENC_KEY: '' },
])('rejects invalid signing/encryption configuration', async (patch) => {
  await expect(
    assertStaffRuntimeReady({}, { ...env, ...patch })
  ).rejects.toThrow('signing keys');
});
test.each([
  { rows: [] },
  { rows: [{ ready: false }] },
  { rows: [{ ready: null }] },
])('fails closed on an unsafe database boundary', async ({ rows }) => {
  await expect(
    assertStaffRuntimeReady({ $queryRaw: async () => rows }, env)
  ).rejects.toThrow('boundary');
});
test('accepts a verified runtime boundary', async () => {
  await expect(
    assertStaffRuntimeReady({ $queryRaw: async () => [{ ready: true }] }, env)
  ).resolves.toBeUndefined();
});

test('rejects a database signing-key mismatch after privilege verification', async () => {
  const db = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ ready: true }])
      .mockResolvedValueOnce([{ ready: false }]),
  };
  await expect(assertStaffRuntimeReady(db, env)).rejects.toThrow(
    'does not match'
  );
});
