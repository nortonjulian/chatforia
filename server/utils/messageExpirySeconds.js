// The route accepts an explicit zero to override a user's default timer.
// Plan-specific maximums are enforced by createMessageService.
export function normalizeRequestedExpireSeconds(value) {
  if (value == null || value === '') return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return undefined;
  if (seconds <= 0) return 0;
  return Math.max(5, Math.min(30 * 24 * 60 * 60, seconds));
}
