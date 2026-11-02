import {
  canDelegateStaffProfile,
  canRevokeStaffProfile,
} from '../staffDelegation.js';

const request = (overrides = {}) => ({
  actorUserId: 10,
  targetUserId: 20,
  actorAssignment: {
    profile: 'CTO',
    active: true,
  },
  targetProfile: 'SENIOR_ENGINEER',
  ...overrides,
});

describe('staff profile delegation policy', () => {
  test('CTO can assign approved engineering profiles', () => {
    for (const targetProfile of [
      'ENGINEERING_MANAGER',
      'SENIOR_ENGINEER',
    ]) {
      expect(canDelegateStaffProfile(
        request({ targetProfile })
      )).toBe(true);
    }
  });

  test('CTO cannot assign CTO or founder authority', () => {
    for (const targetProfile of [
      'CTO',
      'FOUNDER',
      'ACCESS_ADMIN',
      'SUPPORT',
    ]) {
      expect(canDelegateStaffProfile(
        request({ targetProfile })
      )).toBe(false);
    }
  });

  test('Access Administrator has limited delegation', () => {
    for (const targetProfile of [
      'SENIOR_ENGINEER',
      'SUPPORT',
    ]) {
      expect(canDelegateStaffProfile(request({
        actorAssignment: {
          profile: 'ACCESS_ADMIN',
          active: true,
        },
        targetProfile,
      }))).toBe(true);
    }

    expect(canDelegateStaffProfile(request({
      actorAssignment: {
        profile: 'ACCESS_ADMIN',
        active: true,
      },
      targetProfile: 'ENGINEERING_MANAGER',
    }))).toBe(false);
  });

  test('engineering manager cannot delegate yet', () => {
    expect(canDelegateStaffProfile(request({
      actorAssignment: {
        profile: 'ENGINEERING_MANAGER',
        active: true,
      },
    }))).toBe(false);
  });

  test('rejects self-assignment', () => {
    expect(canDelegateStaffProfile(request({
      targetUserId: 10,
    }))).toBe(false);
  });

  test('rejects inactive or unknown actor assignments', () => {
    for (const actorAssignment of [
      null,
      { profile: 'CTO', active: false },
      { profile: 'FOUNDER', active: true },
    ]) {
      expect(canDelegateStaffProfile(request({
        actorAssignment,
      }))).toBe(false);
    }
  });

  test('rejects invalid actor and target IDs', () => {
    for (const id of [0, -1, '10', null, 1.5]) {
      expect(canDelegateStaffProfile(request({
        actorUserId: id,
      }))).toBe(false);

      expect(canDelegateStaffProfile(request({
        targetUserId: id,
      }))).toBe(false);
    }
  });

  test('CTO cannot downgrade another CTO', () => {
    expect(canDelegateStaffProfile(request({
      targetProfile: 'SENIOR_ENGINEER',
      existingTargetAssignment: {
        profile: 'CTO',
        active: true,
      },
    }))).toBe(false);
  });

  test('Access Administrator cannot replace a CTO', () => {
    expect(canDelegateStaffProfile(request({
      actorAssignment: {
        profile: 'ACCESS_ADMIN',
        active: true,
      },
      targetProfile: 'SUPPORT',
      existingTargetAssignment: {
        profile: 'CTO',
        active: true,
      },
    }))).toBe(false);
  });

  test('revoked privileged assignments remain protected', () => {
    expect(canDelegateStaffProfile(request({
      targetProfile: 'SENIOR_ENGINEER',
      existingTargetAssignment: {
        profile: 'CTO',
        active: false,
      },
    }))).toBe(false);
  });

  test('CTO can change profiles within delegated scope', () => {
    expect(canDelegateStaffProfile(request({
      targetProfile: 'ENGINEERING_MANAGER',
      existingTargetAssignment: {
        profile: 'SENIOR_ENGINEER',
        active: true,
      },
    }))).toBe(true);
  });

  test('rejects malformed existing assignments', () => {
    for (const existingTargetAssignment of [
      {},
      { profile: 'FOUNDER', active: true },
      { profile: 'UNKNOWN', active: false },
      'CTO',
    ]) {
      expect(canDelegateStaffProfile(request({
        existingTargetAssignment,
      }))).toBe(false);
    }
  });

  test('rejects unknown target profiles', () => {
    expect(canDelegateStaffProfile(request({
      targetProfile: 'SUPER_ADMIN',
    }))).toBe(false);
  });
});

describe('staff revocation delegation policy', () => {
  const revokeRequest = (overrides = {}) => ({
    actorUserId: 10,
    targetUserId: 20,
    actorAssignment: {
      profile: 'CTO',
      active: true,
    },
    existingTargetAssignment: {
      profile: 'SENIOR_ENGINEER',
      active: true,
    },
    ...overrides,
  });

  test('CTO can revoke approved engineering profiles', () => {
    for (const profile of [
      'ENGINEERING_MANAGER',
      'SENIOR_ENGINEER',
    ]) {
      expect(canRevokeStaffProfile(revokeRequest({
        existingTargetAssignment: {
          profile,
          active: true,
        },
      }))).toBe(true);
    }
  });

  test('CTO cannot revoke another CTO', () => {
    expect(canRevokeStaffProfile(revokeRequest({
      existingTargetAssignment: {
        profile: 'CTO',
        active: true,
      },
    }))).toBe(false);
  });

  test('Access Administrator cannot revoke leadership', () => {
    expect(canRevokeStaffProfile(revokeRequest({
      actorAssignment: {
        profile: 'ACCESS_ADMIN',
        active: true,
      },
      existingTargetAssignment: {
        profile: 'ENGINEERING_MANAGER',
        active: true,
      },
    }))).toBe(false);
  });

  test('Access Administrator can revoke Support', () => {
    expect(canRevokeStaffProfile(revokeRequest({
      actorAssignment: {
        profile: 'ACCESS_ADMIN',
        active: true,
      },
      existingTargetAssignment: {
        profile: 'SUPPORT',
        active: true,
      },
    }))).toBe(true);
  });

  test('Engineering Manager cannot delegate revocation', () => {
    expect(canRevokeStaffProfile(revokeRequest({
      actorAssignment: {
        profile: 'ENGINEERING_MANAGER',
        active: true,
      },
    }))).toBe(false);
  });

  test('rejects self-revocation', () => {
    expect(canRevokeStaffProfile(revokeRequest({
      targetUserId: 10,
    }))).toBe(false);
  });

  test('rejects inactive or missing assignments', () => {
    for (const existingTargetAssignment of [
      null,
      { profile: 'SENIOR_ENGINEER', active: false },
      { profile: 'UNKNOWN', active: true },
    ]) {
      expect(canRevokeStaffProfile(revokeRequest({
        existingTargetAssignment,
      }))).toBe(false);
    }

    expect(canRevokeStaffProfile(revokeRequest({
      actorAssignment: {
        profile: 'CTO',
        active: false,
      },
    }))).toBe(false);
  });

  test('rejects invalid account IDs', () => {
    for (const id of [null, 0, -1, '10', 1.5]) {
      expect(canRevokeStaffProfile(revokeRequest({
        actorUserId: id,
      }))).toBe(false);

      expect(canRevokeStaffProfile(revokeRequest({
        targetUserId: id,
      }))).toBe(false);
    }
  });
});
