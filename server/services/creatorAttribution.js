// Attribution only: never grants entitlements or creates a commission.
export function creatorAttributionFields(rawCode, source) {
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return {};
  const approved = new Set((process.env.CREATOR_PILOT_CODES || '')
    .split(',').map(value => value.trim().toUpperCase()).filter(Boolean));
  if (!approved.has(code)) return {};
  const allowedSources = ['registration', 'web-google', 'web-apple', 'ios-google', 'ios-apple', 'android-google'];
  return {
    creatorReferralCode: code,
    creatorReferralSource: allowedSources.includes(source) ? source : 'registration',
    creatorReferredAt: new Date(),
  };
}
