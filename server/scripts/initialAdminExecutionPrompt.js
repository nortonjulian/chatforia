/**
 * Interactive operator confirmation for initial administrator promotion.
 *
 * This module performs no database operations.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  INITIAL_ADMIN_EXECUTION_CONFIRMATION,
} from './initialAdminExecutionAuthorization.js';

export async function requestInitialAdminExecutionConfirmation({
  input = stdin,
  output = stdout,
} = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      'Interactive terminal required for administrator promotion'
    );
  }

  const rl = createInterface({ input, output });

  try {
    const confirmation = await rl.question(
      `Type "${INITIAL_ADMIN_EXECUTION_CONFIRMATION}" to continue: `
    );

    if (confirmation !== INITIAL_ADMIN_EXECUTION_CONFIRMATION) {
      throw new Error('Administrator execution confirmation mismatch');
    }

    return confirmation;
  } finally {
    rl.close();
  }
}
