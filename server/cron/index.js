import { initDeleteExpired } from './deleteExpiredMessages.js';
import { purgeResetTokensJob } from './purgeResetTokens.js';
import { initGooglePlayReconciliation } from './googlePlayReconciliation.js';

let cronsStarted = false;
let deleteExpiredHandle = null;
let purgeInterval = null;
let purgeTimeout = null;
let googlePlayReconciliationHandle = null;

export function initCrons(io) {
  if (cronsStarted) return;

  cronsStarted = true;

  deleteExpiredHandle =
    initDeleteExpired(io);

  googlePlayReconciliationHandle =
    initGooglePlayReconciliation();

  purgeInterval = setInterval(async () => {
    try {
      await purgeResetTokensJob();
    } catch (err) {
      console.error(
        '[purgeResetTokensJob] failed:',
        err
      );
    }
  }, 60 * 60 * 1000);

  purgeTimeout = setTimeout(async () => {
    try {
      await purgeResetTokensJob();
    } catch (err) {
      console.error(
        '[purgeResetTokensJob] failed:',
        err
      );
    }
  }, 10 * 1000);
}

export async function stopCrons() {
  if (deleteExpiredHandle?.stop) {
    await deleteExpiredHandle.stop();
  }

  if (
    googlePlayReconciliationHandle?.stop
  ) {
    await googlePlayReconciliationHandle.stop();
  }

  if (purgeInterval) {
    clearInterval(purgeInterval);
  }

  if (purgeTimeout) {
    clearTimeout(purgeTimeout);
  }

  cronsStarted = false;
  deleteExpiredHandle = null;
  purgeInterval = null;
  purgeTimeout = null;
  googlePlayReconciliationHandle = null;
}
