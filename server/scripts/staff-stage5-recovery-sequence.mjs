// Shared by the production adapter and disposable PostgreSQL rehearsal.
// Cleanup is armed BEFORE enable: a disconnected client can lose a successful
// COMMIT acknowledgement. No migration step is retried.
export async function runRecoverySequence(steps, interrupted = () => false) {
  const check = () => {
    if (interrupted()) throw new Error('Recovery interrupted');
  };
  check();
  await steps.failed();
  check();
  await steps.beforeEnable();
  check();
  let failure;
  let cleanupFailure;
  try {
    await steps.enable();
    check();
    await steps.resolve();
    check();
    await steps.resolved();
    check();
    await steps.beforeDeploy();
    check();
    await steps.deploy();
  } catch (error) {
    failure = error;
  } finally {
    // Deliberately not gated by interruption/deadline or successful deployment.
    try {
      await steps.disable();
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (cleanupFailure) {
    throw new Error(
      'STOP: cleanup unverified; keep writers stopped and traffic fenced'
    );
  }
  if (failure)
    throw new Error(
      'STOP: recovery failed; cleanup passed; no retry permitted'
    );
  check();
  await steps.complete();
}
