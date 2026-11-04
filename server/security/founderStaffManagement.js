import { getProtectedFounderUserId } from './founderIdentity.js';
import { createStaffAuthorizationAssertion } from './staffAuthorizationAssertion.js';
import { STAFF_PROFILES } from './staffPermissions.js';

// The database repeats ownership, account, target and token-version checks
// under its management locks before consuming the single-use assertion.
export async function hasFounderStaffSession(db, user, auth) {
  if (!user?.id || user.twoFactorEnabled !== true || auth?.mfaVerified !== true ||
      !Number.isSafeInteger(auth.tokenVersion) || auth.tokenVersion < 0) return false;
  return user.id === await getProtectedFounderUserId(db);
}

export async function changeFounderStaffAccess(db, user, auth, targetUserId, action, profile, reason) {
  return db.$transaction(async (tx) => {
    if (targetUserId === user.id || !await hasFounderStaffSession(tx, user, auth)) {
      throw new Error('Founder staff action denied.');
    }
    const granting = action === 'grant';
    if (!granting && action !== 'revoke') throw new Error('Unknown staff action.');
    const targetProfile = granting ? profile : (await tx.staffAssignment.findUnique({
      where: { userId: targetUserId }, select: { profile: true },
    }))?.profile;
    if (!Object.hasOwn(STAFF_PROFILES, targetProfile)) throw new Error('Invalid target profile.');
    const assertion = createStaffAuthorizationAssertion({
      actorUserId: user.id, targetUserId, targetProfile, tokenVersion: auth.tokenVersion,
      mfaVerified: auth.mfaVerified,
      action: granting ? 'STAFF_ACCESS_GRANT_OR_CHANGE' : 'STAFF_ACCESS_REVOKE',
    });
    const rows = granting
      ? await tx.$queryRaw`SELECT staff_security.founder_grant_or_change_staff_access(${assertion}::text, ${reason}::text) AS result`
      : await tx.$queryRaw`SELECT staff_security.founder_revoke_staff_access(${assertion}::text, ${reason}::text) AS result`;
    return rows[0].result;
  }, { isolationLevel: 'Serializable' });
}
