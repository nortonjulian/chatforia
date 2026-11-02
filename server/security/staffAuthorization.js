import {
  createRequireStaffPermission,
} from './requireStaffPermission.js';

import {
  lookupStaffAssignment,
} from './staffAssignmentLookup.js';

/**
 * Permission middleware backed by the current database assignment.
 *
 * Routes must mount requireAuth before this middleware.
 * No profile or account ID is accepted from the client.
 */
export function requireStaffPermission(permission) {
  return createRequireStaffPermission(
    permission,
    lookupStaffAssignment
  );
}
