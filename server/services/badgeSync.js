import { sendPushToUser } from './pushService.js';

/**
 * Best-effort synchronization of the authoritative badge state to
 * every registered device for this user.
 *
 * The underlying push service calculates getBadgeState(userId) at send time.
 * A push failure must never fail the user's read/acknowledgement operation.
 */
export async function syncBadgeToUserDevices(userId, reason = '') {
  try {
    return await sendPushToUser(userId, {
      badgeOnly: true,
      sound: null,
      data: {
        type: 'badge_state_changed',
        reason,
      },
    });
  } catch (error) {
    console.warn('[badge-sync] failed', {
      userId: Number(userId),
      reason,
      error: error?.message || String(error),
    });

    return null;
  }
}
