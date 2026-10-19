function validSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function callingAllowance(snapshot) {
  const meter = snapshot?.usage?.hostedParticipantSeconds;
  if (!meter || !validSeconds(meter.used)) return null;
  if (meter.limit !== null && !validSeconds(meter.limit)) return null;
  if (meter.limit !== null && !validSeconds(meter.remaining)) return null;

  const formatMinutes = seconds => new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(Math.floor(seconds / 6) / 10);
  const remaining = meter.limit === null ? null
    : Math.max(0, Math.min(meter.remaining, meter.limit - meter.used));
  const resetDate = typeof snapshot.resetAt === 'string' ? new Date(snapshot.resetAt) : null;
  const resetLabel = resetDate && Number.isFinite(resetDate.getTime())
    ? new Intl.DateTimeFormat(undefined, {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }).format(resetDate)
    : null;

  return {
    unlimited: meter.limit === null,
    remaining: remaining === null ? null : formatMinutes(remaining),
    limit: meter.limit === null ? null : formatMinutes(meter.limit),
    twoPersonMinutes: remaining === null ? null : formatMinutes(remaining / 2),
    exhausted: remaining === 0,
    resetLabel,
  };
}
