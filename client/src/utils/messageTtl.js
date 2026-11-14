export const MESSAGE_TTL_OPTIONS = [
  { value: '0', labelKey: 'messageInput.ttl.off', fallback: 'Off' },
  { value: '10', fallback: '10s' },
  { value: '60', fallback: '1m' },
  { value: '600', fallback: '10m' },
  { value: '3600', fallback: '1h' },
  { value: '86400', fallback: '1d', days: 1 },
  { value: '259200', fallback: '3d', days: 3 },
  { value: '604800', fallback: '7d', days: 7 },
  { value: '1209600', fallback: '14d', days: 14 },
  { value: '2592000', fallback: '30d', days: 30 },
];

export function buildMessageTtlOptions(rawOptions, expireMaxDays, t) {
  const maxDays = Number(expireMaxDays || 1);

  return rawOptions
    .filter((opt) => !opt.days || opt.days <= maxDays)
    .map((opt) => ({
      value: opt.value,
      label: opt.labelKey ? t(opt.labelKey, opt.fallback) : opt.fallback,
    }));
}

export function clampMessageTtlSeconds(value, expireMaxDays) {
  const nextValue = Number(value || 0);
  const maxDays = Number(expireMaxDays || 1);
  const maxSeconds = maxDays * 24 * 60 * 60;

  return Number.isFinite(nextValue) ? Math.max(0, Math.min(nextValue, maxSeconds)) : 0;
}
