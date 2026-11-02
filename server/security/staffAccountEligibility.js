/**
 * Account eligibility checks for delegated staff management.
 *
 * These checks must run against database records loaded
 * inside the privileged transaction.
 *
 * Session MFA proof must originate from trusted authentication
 * middleware, never from request body fields.
 */

function validAccountId(user) {
  return (
    Number.isSafeInteger(user?.id) &&
    user.id > 0 &&
    user.id <= 2147483647
  );
}

function availableAccount(user) {
  return (
    validAccountId(user) &&
    user.isBanned === false &&
    user.deletedAt === null &&
    user.isSystem === false &&
    user.isTestAccount === false
  );
}

export function isEligibleStaffActor(
  user,
  authentication
) {
  return (
    availableAccount(user) &&
    user.role !== 'ADMIN' &&
    user.twoFactorEnabled === true &&
    user.twoFactorEnrolledAt instanceof Date &&
    typeof user.totpSecretEnc === 'string' &&
    user.totpSecretEnc.length > 0 &&
    authentication?.mfaVerified === true
  );
}

export function isEligibleStaffTarget(user) {
  return (
    availableAccount(user) &&
    user.role === 'USER' &&
    user.emailVerifiedAt instanceof Date &&
    user.twoFactorEnabled === true &&
    user.twoFactorEnrolledAt instanceof Date &&
    typeof user.totpSecretEnc === 'string' &&
    user.totpSecretEnc.length > 0
  );
}
