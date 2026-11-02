import {
  STAFF_PROFILES,
  isKnownStaffPermission,
} from './staffPermissions.js';

/**
 * Factory for staff authorization middleware.
 *
 * lookupAssignment(userId) must retrieve the current active
 * assignment from a trusted server-side data source.
 *
 * No lookup means no authorization.
 */
export function createRequireStaffPermission(
  permission,
  lookupAssignment
) {
  if (!isKnownStaffPermission(permission)) {
    throw new Error('Unknown staff permission.');
  }

  return async function requireStaffPermission(req, res, next) {
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    if (
      req.user.twoFactorEnabled !== true ||
      req.auth?.mfaVerified !== true
    ) {
      return res.status(403).json({
        error: 'Verified staff MFA session required',
      });
    }

    if (typeof lookupAssignment !== 'function') {
      return res.status(403).json({
        error: 'Staff access unavailable',
      });
    }

    let assignment;

    try {
      assignment = await lookupAssignment(req.user.id);
    } catch {
      return res.status(503).json({
        error: 'Staff authorization temporarily unavailable',
      });
    }

    if (
      !assignment ||
      assignment.active !== true ||
      !Object.hasOwn(STAFF_PROFILES, assignment.profile)
    ) {
      return res.status(403).json({
        error: 'Staff permission denied',
      });
    }

    const allowed = STAFF_PROFILES[
      assignment.profile
    ].includes(permission);

    if (!allowed) {
      return res.status(403).json({
        error: 'Staff permission denied',
      });
    }

    req.staff = {
      profile: assignment.profile,
      permission,
    };

    return next();
  };
}
