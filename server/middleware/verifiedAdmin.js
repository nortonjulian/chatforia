/**
 * Global administrator privileges require an MFA-verified session.
 *
 * This does not affect room-level ADMIN or MODERATOR roles.
 */
export function hasVerifiedAdminAccess(req) {
  return (
    req?.user?.role === 'ADMIN' &&
    req?.user?.twoFactorEnabled === true &&
    req?.auth?.mfaVerified === true
  );
}
