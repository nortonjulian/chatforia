import prisma from '../utils/prismaClient.js';
import {
  buildDeviceVoiceIdentity,
  buildLegacyVoiceIdentity,
  MAX_VOICE_FANOUT_DEVICES,
  VOICE_REGISTRATION_VERSION,
  normalizeVoicePlatform,
} from '../utils/voiceIdentity.js';

export function isVoiceEligibleDevice(device, userId) {
  if (!device) return false;

  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return false;
  }

  if (device.revokedAt) {
    return false;
  }

  if (
    String(device.pairingStatus || '')
      .trim()
      .toLowerCase() === 'rejected'
  ) {
    return false;
  }

  const platform = normalizeVoicePlatform(device.platform);

  if (!platform) {
    return false;
  }

  if (!String(device.deviceId || '').trim()) {
    return false;
  }

  if (!device.voiceRegisteredAt) {
    return false;
  }

  if (
    Number(device.voiceRegistrationVer) !==
    VOICE_REGISTRATION_VERSION
  ) {
    return false;
  }

  const expectedIdentity = buildDeviceVoiceIdentity(
    numericUserId,
    device.deviceId
  );

  if (
    !expectedIdentity ||
    device.voiceIdentity !== expectedIdentity
  ) {
    return false;
  }

  if (platform === 'ios') {
    const environment = String(
      device.voicePushEnvironment || ''
    )
      .trim()
      .toLowerCase();

    if (
      environment !== 'production' &&
      environment !== 'sandbox'
    ) {
      return false;
    }
  }

  return true;
}

export async function getVoiceEligibleDevices(
  userId,
  {
    limit = MAX_VOICE_FANOUT_DEVICES,
  } = {}
) {
  const numericUserId = Number(userId);

  if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
    return [];
  }

  const safeLimit = Math.min(
    MAX_VOICE_FANOUT_DEVICES,
    Math.max(
      1,
      Number(limit) || MAX_VOICE_FANOUT_DEVICES
    )
  );

  const candidates = await prisma.device.findMany({
    where: {
      userId: numericUserId,
      revokedAt: null,
      voiceRegisteredAt: {
        not: null,
      },
      voiceRegistrationVer:
        VOICE_REGISTRATION_VERSION,
      voiceIdentity: {
        not: null,
      },
    },
    select: {
      deviceId: true,
      platform: true,
      pairingStatus: true,
      revokedAt: true,
      isPrimary: true,
      lastSeenAt: true,
      updatedAt: true,
      voiceIdentity: true,
      voiceRegisteredAt: true,
      voiceRegistrationVer: true,
      voicePushEnvironment: true,
    },
    orderBy: [
      { isPrimary: 'desc' },
      { lastSeenAt: 'desc' },
      { updatedAt: 'desc' },
    ],
    take: MAX_VOICE_FANOUT_DEVICES * 3,
  });

  return candidates
    .filter((device) =>
      isVoiceEligibleDevice(device, numericUserId)
    )
    .slice(0, safeLimit);
}

export async function getVoiceDialDestinations(
  userId,
  {
    allowLegacyFallback = true,
  } = {}
) {
  const numericUserId = Number(userId);

  const devices = await getVoiceEligibleDevices(
    numericUserId
  );

  const deviceDestinations = devices
    .map((device) => ({
      identity: device.voiceIdentity,
      deviceId: device.deviceId,
      platform: normalizeVoicePlatform(device.platform),
      legacy: false,
    }))
    .filter((destination) =>
      Boolean(destination.identity)
    );

  if (deviceDestinations.length > 0) {
    return deviceDestinations;
  }

  /*
   * Temporary migration compatibility only.
   *
   * Remove this fallback after supported Android/iOS versions
   * reliably confirm device-specific Voice registration.
   */
  if (!allowLegacyFallback) {
    return [];
  }

  const legacyIdentity =
    buildLegacyVoiceIdentity(numericUserId);

  return legacyIdentity
    ? [
        {
          identity: legacyIdentity,
          deviceId: null,
          platform: null,
          legacy: true,
        },
      ]
    : [];
}
