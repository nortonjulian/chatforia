import { initDeleteExpired } from './deleteExpiredMessages.js';
import { purgeResetTokensJob } from './purgeResetTokens.js';

let cronsStarted = false;
let deleteExpiredHandle = null;
let purgeInterval = null;
let purgeTimeout = null;

export function initCrons(io) {
  if (cronsStarted) return;

  cronsStarted = true;

  deleteExpiredHandle = initDeleteExpired(io);

  purgeInterval = setInterval(async () => {
    try {
      await purgeResetTokensJob();
    } catch (err) {
      console.error('[purgeResetTokensJob] failed:', err);
    }
  }, 60 * 60 * 1000);

  purgeTimeout = setTimeout(async () => {
    try {
      await purgeResetTokensJob();
    } catch (err) {
      console.error('[purgeResetTokensJob] failed:', err);
    }
  }, 10 * 1000);
}

export async function stopCrons() {
  if (deleteExpiredHandle?.stop) {
    await deleteExpiredHandle.stop();
  }
  if (purgeInterval) clearInterval(purgeInterval);
  if (purgeTimeout) clearTimeout(purgeTimeout);

  cronsStarted = false;
  deleteExpiredHandle = null;
  purgeInterval = null;
  purgeTimeout = null;
}