import { PassThrough } from 'node:stream';
import {
  requestInitialAdminExecutionConfirmation,
} from '../initialAdminExecutionPrompt.js';

import {
  INITIAL_ADMIN_EXECUTION_CONFIRMATION,
} from '../initialAdminExecutionAuthorization.js';

function makeTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();

  input.isTTY = true;
  output.isTTY = true;

  output.on('data', () => {});

  return { input, output };
}

describe('initial administrator execution prompt', () => {
  test('rejects noninteractive input', async () => {
    const { input, output } = makeTerminal();
    input.isTTY = false;

    await expect(
      requestInitialAdminExecutionConfirmation({ input, output })
    ).rejects.toThrow('Interactive terminal required');

    input.destroy();
    output.destroy();
  });

  test('rejects noninteractive output', async () => {
    const { input, output } = makeTerminal();
    output.isTTY = false;

    await expect(
      requestInitialAdminExecutionConfirmation({ input, output })
    ).rejects.toThrow('Interactive terminal required');

    input.destroy();
    output.destroy();
  });

  test('accepts exact confirmation', async () => {
    const { input, output } = makeTerminal();

    const pending = requestInitialAdminExecutionConfirmation({
      input,
      output,
    });

    input.write(`${INITIAL_ADMIN_EXECUTION_CONFIRMATION}\n`);

    await expect(pending).resolves.toBe(
      INITIAL_ADMIN_EXECUTION_CONFIRMATION
    );

    input.destroy();
    output.destroy();
  });

  test('rejects incorrect confirmation', async () => {
    const { input, output } = makeTerminal();

    const pending = requestInitialAdminExecutionConfirmation({
      input,
      output,
    });

    input.write('yes\n');

    await expect(pending).rejects.toThrow(
      'Administrator execution confirmation mismatch'
    );

    input.destroy();
    output.destroy();
  });
});
