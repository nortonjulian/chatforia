import { staffCanaryIds, staffCohortAllows } from '../staffRollout.js';
import { assertStaffRuntimeReady } from '../staffRuntimeReadiness.js';

test('production cohort grants no authorization by itself and limits eligible identities', () => {
  const env = { NODE_ENV: 'production', STAFF_DASHBOARD_USER_IDS: '17, 18,17' };
  expect(staffCanaryIds(env.STAFF_DASHBOARD_USER_IDS)).toEqual([17, 18]);
  expect(staffCohortAllows(17, env)).toBe(true);
  expect(staffCohortAllows(19, env)).toBe(false);
});
test.each([
  '',
  '*',
  '17,',
  '-1',
  '0',
  '2147483648',
  '17,invalid',
  Array(201).fill('17').join(','),
])('malformed production cohort fails closed: %s', (value) => {
  expect(
    staffCohortAllows(17, {
      NODE_ENV: 'production',
      STAFF_DASHBOARD_USER_IDS: value,
    })
  ).toBe(false);
});
test('production startup refuses a dashboard without an explicit cohort', async () => {
  await expect(
    assertStaffRuntimeReady(
      {},
      {
        NODE_ENV: 'production',
        STAFF_SECURITY_ENABLED: 'true',
        STAFF_DASHBOARD_ENABLED: 'true',
      }
    )
  ).rejects.toThrow('canary cohort');
});
test('dashboard cannot start without authentication security', async () => {
  await expect(
    assertStaffRuntimeReady({}, { STAFF_DASHBOARD_ENABLED: 'true' })
  ).rejects.toThrow('requires security');
});
