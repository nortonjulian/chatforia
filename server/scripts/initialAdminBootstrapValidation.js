/**
 * Validation for Chatforia's one-time company administrator bootstrap.
 *
 * This module performs no database operations.
 */

export const INITIAL_ADMIN_EMAIL = 'julian@chatforia.com';

export function validateInitialAdminAccount(user) {
  if (!user) {
    throw new Error('Target account not found');
  }

  if (
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    user.id > 2147483647
  ) {
    throw new Error('Invalid target account ID');
  }

  if (
    typeof user.email !== 'string' ||
    user.email.trim().toLowerCase() !== INITIAL_ADMIN_EMAIL
  ) {
    throw new Error('Unexpected administrator account identity');
  }

  if (user.role !== 'USER') {
    throw new Error('Target account must have USER role');
  }

  if (user.isBanned || user.deletedAt) {
    throw new Error('Target account is unavailable');
  }

  if (!user.emailVerifiedAt) {
    throw new Error('Target email is not verified');
  }

  if (
    user.twoFactorEnabled !== true ||
    !user.totpSecretEnc ||
    !user.twoFactorEnrolledAt
  ) {
    throw new Error('Target account MFA enrollment is incomplete');
  }

  if (
    !Number.isSafeInteger(user.tokenVersion) ||
    user.tokenVersion < 0
  ) {
    throw new Error('Invalid session version');
  }

  return {
    id: user.id,
    email: INITIAL_ADMIN_EMAIL,
    role: user.role,
    tokenVersion: user.tokenVersion,
  };
}
