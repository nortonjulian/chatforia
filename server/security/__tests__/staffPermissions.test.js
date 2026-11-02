import {
  STAFF_PERMISSIONS,
  STAFF_PROFILES,
  DELEGATABLE_PROFILES,
  isKnownStaffPermission,
  isKnownStaffProfile,
} from '../staffPermissions.js';

describe('Chatforia staff permission catalog', () => {
  test('recognizes only defined permissions', () => {
    expect(isKnownStaffPermission('users.read')).toBe(true);
    expect(isKnownStaffPermission('staff.assign')).toBe(true);
    expect(isKnownStaffPermission('founder.transfer')).toBe(false);
    expect(isKnownStaffPermission('users.delete')).toBe(false);
  });

  test('recognizes only defined profiles', () => {
    expect(isKnownStaffProfile('CTO')).toBe(true);
    expect(isKnownStaffProfile('ENGINEERING_MANAGER')).toBe(true);
    expect(isKnownStaffProfile('SENIOR_ENGINEER')).toBe(true);
    expect(isKnownStaffProfile('FOUNDER')).toBe(false);
    expect(isKnownStaffProfile('UNKNOWN')).toBe(false);
  });

  test('CTO can oversee engineering without founder ownership', () => {
    expect(STAFF_PROFILES.CTO).toContain(
      STAFF_PERMISSIONS.STAFF_ASSIGN
    );
    expect(STAFF_PROFILES.CTO).toContain(
      STAFF_PERMISSIONS.SECURITY_RESPOND
    );
    expect(STAFF_PROFILES.CTO).not.toContain('founder.transfer');
  });

  test('engineering manager cannot automatically delegate access', () => {
    expect(STAFF_PROFILES.ENGINEERING_MANAGER).toContain(
      STAFF_PERMISSIONS.USERS_READ
    );
    expect(STAFF_PROFILES.ENGINEERING_MANAGER).not.toContain(
      STAFF_PERMISSIONS.STAFF_ASSIGN
    );
  });

  test('senior engineer has no account-management permission', () => {
    expect(STAFF_PROFILES.SENIOR_ENGINEER).toContain(
      STAFF_PERMISSIONS.USERS_READ
    );
    expect(STAFF_PROFILES.SENIOR_ENGINEER).not.toContain(
      STAFF_PERMISSIONS.USERS_MANAGE
    );
  });

  test('only approved profiles are delegatable', () => {
    expect(DELEGATABLE_PROFILES).toContain('SENIOR_ENGINEER');
    expect(DELEGATABLE_PROFILES).not.toContain('CTO');
    expect(DELEGATABLE_PROFILES).not.toContain('ACCESS_ADMIN');
    expect(DELEGATABLE_PROFILES).not.toContain('FOUNDER');
  });

  test('profile definitions are immutable', () => {
    expect(Object.isFrozen(STAFF_PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(STAFF_PROFILES)).toBe(true);
    expect(Object.isFrozen(STAFF_PROFILES.CTO)).toBe(true);
  });
});
