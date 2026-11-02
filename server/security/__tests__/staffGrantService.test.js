import { jest, beforeEach, afterAll, describe, test, expect } from '@jest/globals';
import { fileURLToPath } from 'node:url';

const preflightPath = fileURLToPath(
  new URL('../staffManagementPreflight.js', import.meta.url)
);

const authorizeMock = jest.fn();

await jest.unstable_mockModule(preflightPath, () => ({
  authorizeStaffGrantChange: authorizeMock,
}));

const { grantOrChangeStaffAccess } =
  await import('../staffGrantService.js');

const {
  verifyStaffAuthorizationAssertion,
} = await import('../staffAuthorizationAssertion.js');

const originalSecret = process.env.STAFF_ACCESS_SIGNING_SECRET;
const testSecret = 'staff-qa-isolated-signing-key-2026-' + 'x'.repeat(40);

const expectedResult = {
  action: 'STAFF_PROFILE_CHANGED',
  targetUserId: 20,
  profile: 'SENIOR_ENGINEER',
  sessionsRevoked: true,
};

function request(db) {
  return {
    actorUserId: 10,
    targetUserId: 20,
    targetProfile: 'SENIOR_ENGINEER',
    authentication: {
      tokenVersion: 3,
      mfaVerified: true,
    },
    reason: 'Approved engineering profile change',
    db,
  };
}

function database(result = expectedResult) {
  const tx = {
    $queryRaw: jest.fn(async () => [{ result }]),
  };
  const db = {
    $transaction: jest.fn(async (callback) => callback(tx)),
  };
  return { tx, db };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STAFF_ACCESS_SIGNING_SECRET = testSecret;
  authorizeMock.mockResolvedValue({ targetAssignment: { profile: 'SUPPORT', active: true } });
});

afterAll(() => {
  if (originalSecret === undefined) {
    delete process.env.STAFF_ACCESS_SIGNING_SECRET;
  } else {
    process.env.STAFF_ACCESS_SIGNING_SECRET = originalSecret;
  }
});

describe('protected grantOrChangeStaffAccess', () => {
  test('uses the protected PostgreSQL function and preserves response', async () => {
    const { tx, db } = database();
    const result = await grantOrChangeStaffAccess(request(db));

    expect(result).toEqual(expectedResult);
    expect(authorizeMock).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

    const [strings, assertion, reason] = tx.$queryRaw.mock.calls[0];

    expect(strings.join(' ')).toContain(
      'staff_security.grant_or_change_staff_access'
    );

    expect(reason).toBe('Approved engineering profile change');

    expect(verifyStaffAuthorizationAssertion(assertion, {
      secret: testSecret,
    })).toMatchObject({
      actorUserId: 10,
      targetUserId: 20,
      action: 'STAFF_ACCESS_GRANT_OR_CHANGE',
      targetProfile: 'SENIOR_ENGINEER',
      tokenVersion: 3,
      mfaVerified: true,
    });

    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' }
    );
  });

  test('authorization denial prevents protected function invocation', async () => {
    const { tx, db } = database();
    authorizeMock.mockRejectedValue(new Error('Authority denied'));

    await expect(grantOrChangeStaffAccess(request(db)))
      .rejects.toThrow('Authority denied');

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  test('rejects invalid audit reasons before starting a transaction', async () => {
    const { db } = database();

    await expect(grantOrChangeStaffAccess({
      ...request(db),
      reason: 'bad',
    })).rejects.toThrow(/reason is required/);

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  test('rejects malformed protected database responses', async () => {
    const { db } = database(null);

    await expect(grantOrChangeStaffAccess(request(db)))
      .rejects.toThrow(/Invalid protected staff/);
  });

  test('propagates audit failures without retrying', async () => {
    const { tx, db } = database();
    tx.$queryRaw.mockRejectedValue(new Error('Audit unavailable'));

    await expect(grantOrChangeStaffAccess(request(db)))
      .rejects.toThrow('Audit unavailable');

    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  test('rechecks authorization and signs afresh after a conflict', async () => {
    const { tx, db } = database();
    const assertions = [];

    tx.$queryRaw.mockImplementation(async (strings, assertion) => {
      assertions.push(assertion);
      return [{ result: expectedResult }];
    });

    db.$transaction
      .mockImplementationOnce(async (callback) => {
        await callback(tx);
        throw Object.assign(new Error('Serialization conflict'), {
          code: 'P2034',
        });
      })
      .mockImplementationOnce(async (callback) => callback(tx));

    expect(await grantOrChangeStaffAccess(request(db))).toEqual(expectedResult);

    expect(authorizeMock).toHaveBeenCalledTimes(2);
    expect(assertions).toHaveLength(2);
    expect(assertions[0]).not.toBe(assertions[1]);
  });

  test('rejects if authority disappears during a retry', async () => {
    const { tx, db } = database();

    db.$transaction
      .mockImplementationOnce(async (callback) => {
        await callback(tx);
        throw Object.assign(new Error('Serialization conflict'), {
          code: 'P2034',
        });
      })
      .mockImplementationOnce(async (callback) => callback(tx));

    authorizeMock
      .mockResolvedValueOnce({ targetAssignment: { profile: 'SUPPORT', active: true } })
      .mockRejectedValueOnce(new Error('Authority revoked'));

    await expect(grantOrChangeStaffAccess(request(db)))
      .rejects.toThrow('Authority revoked');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  test('stops after three serialization conflicts', async () => {
    const { db } = database();

    db.$transaction.mockRejectedValue(
      Object.assign(new Error('Persistent conflict'), {
        code: 'P2034',
      })
    );

    await expect(grantOrChangeStaffAccess(request(db)))
      .rejects.toThrow('Persistent conflict');

    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
});
