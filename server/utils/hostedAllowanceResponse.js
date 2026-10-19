// Usage months are UTC calendar months, independent of subscription renewal.
export function allowanceResetAt(monthKey) {
  const match = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(String(monthKey || ''));
  if (!match || Number(match[1]) < 1000) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 1)).toISOString();
}

export function hostedAllowanceResponse(availability, isOwner) {
  const resetAt = allowanceResetAt(availability.monthKey);
  const resetText = resetAt
    ? ` It resets on ${new Intl.DateTimeFormat('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }).format(new Date(resetAt))} at 00:00 UTC.`
    : '';
  const ownerText = isOwner ? 'Your' : 'The caller’s';
  const actionText = isOwner
    ? ' Check My plan for usage and available plan options.'
    : ' Ask the caller to check My plan, or start a new call using your own allowance.';

  return {
    error: `${ownerText} monthly app-calling allowance has been used up.${resetText}${actionText}`,
    // Preserve the existing machine-readable contract for installed clients.
    code: 'PLAN_ALLOWANCE_EXCEEDED',
    detail: 'hostedParticipantSeconds',
    limit: availability.limit,
    used: availability.used,
    remaining: availability.remaining,
    monthKey: availability.monthKey,
    resetAt,
    allowanceOwner: isOwner ? 'self' : 'caller',
  };
}
