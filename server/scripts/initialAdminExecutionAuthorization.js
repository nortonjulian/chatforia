/**
 * Pure authorization validation for one-time administrator bootstrap.
 *
 * No database access, network calls, or account modifications.
 */

import { INITIAL_ADMIN_EMAIL } from './initialAdminBootstrapValidation.js';

export const INITIAL_ADMIN_EXECUTION_CONFIRMATION =
  `PROMOTE ${INITIAL_ADMIN_EMAIL} ON defaultdb`;

export function validateInitialAdminExecutionAuthorization({
  execute,
  accountEmail,
  confirmation,
}) {
  if (execute !== true) {
    throw new Error('Explicit administrator execution authorization required');
  }

  if (accountEmail !== INITIAL_ADMIN_EMAIL) {
    throw new Error('Administrator execution account mismatch');
  }

  if (confirmation !== INITIAL_ADMIN_EXECUTION_CONFIRMATION) {
    throw new Error('Administrator execution confirmation mismatch');
  }

  return {
    authorized: true,
    accountEmail: INITIAL_ADMIN_EMAIL,
  };
}
