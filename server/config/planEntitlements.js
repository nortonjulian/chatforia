const GB = 1024 ** 3;

export const PLAN_ENTITLEMENTS = Object.freeze({
  FREE: Object.freeze({
    riaActions: 20,
    translationChars: 5_000,
    hostedParticipantMinutes: 30,
    smsMessages: 100,
    pstnMinutes: 10,
    forwardingMinutes: 0,
    voicemailTranscriptionMinutes: 0,
    cloudStorageBytes: 1 * GB,
    messageHistoryDays: null,
    deviceLimit: 1,
    expireMaxDays: 1,

    adsEnabled: true,
    aiRewriteLevel: 'NONE',
    supportLevel: 'STANDARD',
  }),

  PLUS: Object.freeze({
    riaActions: 200,
    translationChars: 100_000,
    hostedParticipantMinutes: 300,
    smsMessages: 500,
    pstnMinutes: 100,
    forwardingMinutes: 100,
    voicemailTranscriptionMinutes: 0,
    cloudStorageBytes: 15 * GB,
    messageHistoryDays: null,
    deviceLimit: 5,
    expireMaxDays: 30,

    adsEnabled: false,
    aiRewriteLevel: 'STANDARD',
    supportLevel: 'EMAIL',
  }),

  PREMIUM: Object.freeze({
    riaActions: 500,
    translationChars: 1_000_000,
    hostedParticipantMinutes: 600,
    smsMessages: 1500,
    pstnMinutes: 300,
    forwardingMinutes: 300,
    voicemailTranscriptionMinutes: 30,
    cloudStorageBytes: 50 * GB,
    messageHistoryDays: null,
    deviceLimit: 5,
    expireMaxDays: 30,

    adsEnabled: false,
    aiRewriteLevel: 'FULL',
    supportLevel: 'PRIORITY',
  }),
});

export function normalizePlan(plan) {
  const normalized = String(plan || 'FREE').toUpperCase();

  return Object.prototype.hasOwnProperty.call(
    PLAN_ENTITLEMENTS,
    normalized,
  )
    ? normalized
    : 'FREE';
}

export function getPlanEntitlements(plan) {
  return PLAN_ENTITLEMENTS[normalizePlan(plan)];
}
