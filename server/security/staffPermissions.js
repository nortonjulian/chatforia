/**
 * Chatforia staff permission catalog.
 *
 * These definitions do not grant privileges by themselves.
 * Staff assignments must be verified against persistent,
 * server-authoritative records before authorization.
 */

export const STAFF_PERMISSIONS = Object.freeze({
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  REPORTS_READ: 'reports.read',
  REPORTS_RESOLVE: 'reports.resolve',
  AUDIT_READ: 'audit.read',
  STAFF_READ: 'staff.read',
  STAFF_ASSIGN: 'staff.assign',
  SECURITY_RESPOND: 'security.respond',
});

export const STAFF_PROFILES = Object.freeze({
  CTO: Object.freeze([
    STAFF_PERMISSIONS.USERS_READ,
    STAFF_PERMISSIONS.REPORTS_READ,
    STAFF_PERMISSIONS.AUDIT_READ,
    STAFF_PERMISSIONS.STAFF_READ,
    STAFF_PERMISSIONS.STAFF_ASSIGN,
    STAFF_PERMISSIONS.SECURITY_RESPOND,
  ]),

  ENGINEERING_MANAGER: Object.freeze([
    STAFF_PERMISSIONS.USERS_READ,
    STAFF_PERMISSIONS.REPORTS_READ,
    STAFF_PERMISSIONS.AUDIT_READ,
    STAFF_PERMISSIONS.STAFF_READ,
  ]),

  SENIOR_ENGINEER: Object.freeze([
    STAFF_PERMISSIONS.USERS_READ,
    STAFF_PERMISSIONS.REPORTS_READ,
  ]),

  SUPPORT: Object.freeze([
    STAFF_PERMISSIONS.USERS_READ,
    STAFF_PERMISSIONS.REPORTS_READ,
    STAFF_PERMISSIONS.REPORTS_RESOLVE,
  ]),

  ACCESS_ADMIN: Object.freeze([
    STAFF_PERMISSIONS.STAFF_READ,
    STAFF_PERMISSIONS.STAFF_ASSIGN,
  ]),
});

export const DELEGATABLE_PROFILES = Object.freeze([
  'ENGINEERING_MANAGER',
  'SENIOR_ENGINEER',
  'SUPPORT',
]);

export function isKnownStaffPermission(permission) {
  return Object.values(STAFF_PERMISSIONS).includes(permission);
}

export function isKnownStaffProfile(profile) {
  return Object.hasOwn(STAFF_PROFILES, profile);
}
