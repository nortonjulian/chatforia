export const MAX_VOICE_FANOUT_DEVICES = 10;
export const VOICE_REGISTRATION_VERSION = 1;

export function normalizeVoiceIdentityPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_');
}

export function buildDeviceVoiceIdentity(userId, deviceId) {
  const numericUserId = Number(userId);
  const safeDeviceId = normalizeVoiceIdentityPart(deviceId);

  if (
    !Number.isInteger(numericUserId) ||
    numericUserId <= 0 ||
    !safeDeviceId
  ) {
    return null;
  }

  return `user_${numericUserId}_device_${safeDeviceId}`;
}

export function buildLegacyVoiceIdentity(userId) {
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return null;
  }

  return `user_${numericUserId}`;
}

export function parseVoiceIdentity(identity) {
  const raw = String(identity || '')
    .trim()
    .replace(/^client:/, '');

  const match = raw.match(
    /^user_(\d+)(?:_device_(.+))?$/
  );

  if (!match) {
    return null;
  }

  const userId = Number(match[1]);

  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  return {
    identity: raw,
    userId,
    deviceSpecific: Boolean(match[2]),
    deviceIdentityPart: match[2] || null,
  };
}

export function parseVoiceIdentityUserId(identity) {
  return parseVoiceIdentity(identity)?.userId ?? null;
}
