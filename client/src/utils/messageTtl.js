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

  return Math.min(nextValue, maxSeconds);
}
