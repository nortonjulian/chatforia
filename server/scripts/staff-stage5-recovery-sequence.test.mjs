import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRecoverySequence } from './staff-stage5-recovery-sequence.mjs';

const order = [
  'failed',
  'beforeEnable',
  'enable',
  'resolve',
  'resolved',
  'beforeDeploy',
  'deploy',
  'disable',
  'complete',
];
function fixture(fail, interrupt) {
  const calls = [];
  let interrupted = false;
  const steps = Object.fromEntries(
    order.map((name) => [
      name,
      async () => {
        calls.push(name);
        if (interrupt === name) interrupted = true;
        if (fail === name) throw new Error('private driver diagnostic');
      },
    ])
  );
  return { steps, calls, interrupted: () => interrupted };
}
test('success removes privileges before complete-phase checks', async () => {
  const f = fixture();
  await runRecoverySequence(f.steps);
  assert.deepEqual(f.calls, order);
});
for (const fail of order) {
  test(`failure at ${fail}: no retry, cleanup whenever enable was attempted`, async () => {
    const f = fixture(fail);
    await assert.rejects(runRecoverySequence(f.steps));
    assert.equal(
      f.calls.filter((name) => name === 'disable').length,
      order.indexOf(fail) >= order.indexOf('enable') ? 1 : 0
    );
    assert.equal(new Set(f.calls).size, f.calls.length);
    if (fail !== 'complete') assert.ok(!f.calls.includes('complete'));
  });
}
for (const interrupt of ['enable', 'resolve', 'resolved', 'deploy']) {
  test(`interruption after ${interrupt} still removes privileges`, async () => {
    const f = fixture(undefined, interrupt);
    await assert.rejects(runRecoverySequence(f.steps, f.interrupted));
    assert.equal(f.calls.at(-1), 'disable');
    assert.equal(
      f.calls.filter((name) => name === 'deploy').length,
      interrupt === 'deploy' ? 1 : 0
    );
  });
}
test('cleanup failure overrides migration failure without exposing driver details', async () => {
  const f = fixture('deploy');
  f.steps.disable = async () => {
    throw new Error('private credential');
  };
  await assert.rejects(runRecoverySequence(f.steps), {
    message:
      'STOP: cleanup unverified; keep writers stopped and traffic fenced',
  });
});
