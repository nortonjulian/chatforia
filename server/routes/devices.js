import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import { sendPushToUser } from '../services/pushService.js';
import { premiumConfig } from '../config/premiumConfig.js';

const router = express.Router();

router.use(express.json());


function normalizeString(value, maxLen = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export function getDeviceLimitForPlan(planValue) {
  const plan =
    String(planValue || 'FREE')
      .trim()
      .toUpperCase();

  return ['PLUS', 'PREMIUM', 'WIRELESS'].includes(plan)
    ? premiumConfig.PREMIUM_DEVICE_LIMIT
    : premiumConfig.FREE_DEVICE_LIMIT;
}

export function shouldRequireDeviceReplacement({
  isCurrentDeviceActive,
  activeOtherDeviceCount,
  deviceLimit,
  replaceExistingDevice,
}) {
  return (
    !isCurrentDeviceActive &&
    activeOtherDeviceCount >= deviceLimit &&
    !replaceExistingDevice
  );
}

export function getPushTokenOwnership(
  pushProvider,
  pushEnvironment = 'production'
) {
  if (pushProvider === 'apns_voip') {
    return {
      tokenField:
        pushEnvironment === 'sandbox'
          ? 'voipSandboxPushToken'
          : 'voipPushToken',
    };
  }

  if (pushProvider === 'apns') {
    return {
      tokenField:
        pushEnvironment === 'sandbox'
          ? 'apnsSandboxPushToken'
          : 'apnsPushToken',
    };
  }

  if (pushProvider === 'fcm') {
    return {
      tokenField: 'fcmPushToken',
    };
  }

  return {
    tokenField: 'pushToken',
  };
}

function normalizePairingStatus(value) {
  const v = normalizeString(value, 32)?.toLowerCase();
  if (!v) return null;
  if (v === 'pending' || v === 'approved' || v === 'rejected') return v;
  return null;
}

function normalizeDeviceIds(body) {
  const rawIds =
    Array.isArray(body?.deviceIds)
      ? body.deviceIds
      : [body?.deviceId];

  return Array.from(
    new Set(
      rawIds
        .map((value) =>
          normalizeString(value, 191)
        )
        .filter(Boolean)
    )
  ).slice(0, 100);
}

const deviceSelect = {
  id: true,
  userId: true,
  deviceId: true,
  name: true,
  platform: true,
  publicKey: true,
  keyAlgorithm: true,
  keyVersion: true,
  isPrimary: true,
  wrappedAccountKey: true,
  wrappedAccountKeyAlgo: true,
  wrappedAccountKeyVer: true,
  pairingStatus: true,
  pairingRequestedAt: true,
  pairingApprovedAt: true,
  pairingRejectedAt: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
};

router.post('/register', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const deviceId = normalizeString(req.body?.deviceId, 191);
    const name = normalizeString(req.body?.name, 120) || 'iPhone';
    const platform = normalizeString(req.body?.platform, 120) || 'iOS';
    const publicKey = normalizeString(req.body?.publicKey, 4096);
    const keyAlgorithm =
      normalizeString(req.body?.keyAlgorithm, 50) || 'curve25519';
    const keyVersion = Number(req.body?.keyVersion || 1);

    const replaceExistingDevice =
      req.body?.replaceExistingDevice === true;

    const replaceDeviceId =
      normalizeString(req.body?.replaceDeviceId, 191);

    if (!userId || !deviceId || !publicKey) {
      return res.status(400).json({
        error: 'deviceId and publicKey are required',
      });
    }

    if (replaceExistingDevice && !replaceDeviceId) {
      return res.status(400).json({
        error: 'replaceDeviceId is required when replacing a device',
        code: 'REPLACE_DEVICE_ID_REQUIRED',
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          plan: true,
        },
      });

      if (!user) {
        return {
          status: 404,
          body: {
            error: 'User not found',
            code: 'USER_NOT_FOUND',
          },
        };
      }

      const plan = String(user.plan || 'FREE').toUpperCase();
      const isPaidPlan =
        ['PLUS', 'PREMIUM', 'WIRELESS'].includes(plan);

      const deviceLimit =
        getDeviceLimitForPlan(plan);

      /*
       * Existing active devices must remain able to refresh their
       * registration and push tokens, even if legacy data has placed the
       * account above its current limit.
       */
      const currentDevice =
        await tx.device.findUnique({
          where: {
            userId_deviceId: {
              userId,
              deviceId,
            },
          },
          select: {
            revokedAt: true,
          },
        });

      const isCurrentDeviceActive =
        Boolean(currentDevice) &&
        currentDevice.revokedAt == null;

      /*
       * Revocation is authoritative.
       *
       * A client that retains an old JWT, socket session, push token,
       * or local deviceId must not be able to resurrect a revoked
       * installation simply by calling /devices/register again.
       */
      if (currentDevice?.revokedAt) {
        return {
          status: 409,
          body: {
            error:
              'This device has been revoked and cannot register again.',
            code: 'DEVICE_REVOKED',
          },
        };
      }

      const activeOtherDevices = await tx.device.findMany({
        where: {
          userId,
          revokedAt: null,
          NOT: {
            deviceId,
          },
        },
        orderBy: [
          {
            lastSeenAt: 'desc',
          },
          {
            createdAt: 'desc',
          },
        ],
        select: {
          deviceId: true,
          name: true,
          platform: true,
          lastSeenAt: true,
          createdAt: true,
        },
      });

      const activeDeviceSummaries =
        activeOtherDevices.map((device) => ({
          deviceId: device.deviceId,
          name: device.name,
          platform: device.platform,
          lastSeenAt: device.lastSeenAt,
          createdAt: device.createdAt,
        }));

      if (
        shouldRequireDeviceReplacement({
          isCurrentDeviceActive,
          activeOtherDeviceCount:
            activeOtherDevices.length,
          deviceLimit,
          replaceExistingDevice,
        })
      ) {
        const deviceLabel =
          deviceLimit === 1
            ? 'one active device'
            : `${deviceLimit} active devices`;

        return {
          status: 409,
          body: {
            error:
              `This plan allows ${deviceLabel}. Confirm which existing device should be replaced.`,
            code: 'DEVICE_REPLACEMENT_REQUIRED',
            deviceLimit,
            existingDevices: activeDeviceSummaries,
          },
        };
      }

      if (replaceExistingDevice) {
        const replacementTarget =
          activeOtherDevices.find(
            (device) => device.deviceId === replaceDeviceId
          );

        if (!replacementTarget) {
          return {
            status: 409,
            body: {
              error:
                'The selected replacement device is no longer active. Refresh the device list and try again.',
              code: 'DEVICE_REPLACEMENT_TARGET_STALE',
              existingDevices: activeDeviceSummaries,
            },
          };
        }

        const now = new Date();

        const replacementWhere = isPaidPlan
          ? {
              userId,
              deviceId: replaceDeviceId,
              revokedAt: null,
            }
          : {
              userId,
              deviceId: {
                not: deviceId,
              },
              revokedAt: null,
            };

        await tx.device.updateMany({
          where: replacementWhere,
          data: {
            revokedAt: now,
            revokedById: userId,
            isPrimary: false,
            pushToken: null,
            pushProvider: null,
            apnsPushToken: null,
            apnsSandboxPushToken: null,
            fcmPushToken: null,
            voipPushToken: null,
            voipSandboxPushToken: null,
          },
        });
      }

      const device = await tx.device.upsert({
        where: {
          userId_deviceId: {
            userId,
            deviceId,
          },
        },
        update: {
          name,
          platform,
          publicKey,
          keyAlgorithm,
          keyVersion: Number.isFinite(keyVersion)
            ? keyVersion
            : 1,
          lastSeenAt: new Date(),
          pairingStatus: 'approved',
          pairingApprovedAt: new Date(),
          pairingRejectedAt: null,
        },
        create: {
          userId,
          deviceId,
          name,
          platform,
          publicKey,
          keyAlgorithm,
          keyVersion: Number.isFinite(keyVersion)
            ? keyVersion
            : 1,
          lastSeenAt: new Date(),
          pairingStatus: 'approved',
          pairingApprovedAt: new Date(),
        },
        select: {
          id: true,
          userId: true,
          deviceId: true,
          name: true,
          platform: true,
          publicKey: true,
          keyAlgorithm: true,
          keyVersion: true,
          isPrimary: true,
          lastSeenAt: true,
          createdAt: true,
          updatedAt: true,
          revokedAt: true,
        },
      });

      const replacedDeviceIds =
        replaceExistingDevice
          ? isPaidPlan
            ? [replaceDeviceId]
            : activeOtherDevices.map(
                (item) => item.deviceId
              )
          : [];

      return {
        device,
        replacedDeviceIds,
      };
    });

    if (result.status) {
      return res.status(result.status).json(result.body);
    }

    return res.status(200).json({
      device: result.device,
      replacedDeviceIds: result.replacedDeviceIds,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/pairing/request', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const deviceId = normalizeString(req.body?.deviceId, 191);
    const name = normalizeString(req.body?.name, 120) || 'Browser';
    const platform = normalizeString(req.body?.platform, 120) || 'Web';
    const publicKey = normalizeString(req.body?.publicKey, 4096);
    const keyAlgorithm = normalizeString(req.body?.keyAlgorithm, 50) || 'curve25519';
    const keyVersion = Number(req.body?.keyVersion || 1);

    if (!userId || !deviceId || !publicKey) {
      return res.status(400).json({ error: 'deviceId and publicKey are required' });
    }

    const existingDevice = await prisma.device.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      select: {
        revokedAt: true,
      },
    });

    if (existingDevice?.revokedAt) {
      return res.status(409).json({
        error:
          'This device has been revoked and cannot request pairing.',
        code: 'DEVICE_REVOKED',
      });
    }

    const device = await prisma.device.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      update: {
        name,
        platform,
        publicKey,
        keyAlgorithm,
        keyVersion: Number.isFinite(keyVersion) ? keyVersion : 1,
        lastSeenAt: new Date(),
        wrappedAccountKey: null,
        wrappedAccountKeyAlgo: null,
        wrappedAccountKeyVer: null,
        pairingStatus: 'pending',
        pairingRequestedAt: new Date(),
        pairingApprovedAt: null,
        pairingRejectedAt: null,
      },
      create: {
        userId,
        deviceId,
        name,
        platform,
        publicKey,
        keyAlgorithm,
        keyVersion: Number.isFinite(keyVersion) ? keyVersion : 1,
        lastSeenAt: new Date(),
        wrappedAccountKey: null,
        wrappedAccountKeyAlgo: null,
        wrappedAccountKeyVer: null,
        pairingStatus: 'pending',
        pairingRequestedAt: new Date(),
      },
      select: deviceSelect,
    });

    return res.status(200).json({ device });
  } catch (error) {
    next(error);
  }
});

router.get('/pairing/pending', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const devices = await prisma.device.findMany({
      where: {
        userId,
        revokedAt: null,
        pairingStatus: 'pending',
      },
      orderBy: {
        pairingRequestedAt: 'asc',
      },
      select: deviceSelect,
    });

    return res.json({ items: devices });
  } catch (error) {
    next(error);
  }
});

router.post('/pairing/approve', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const deviceId = normalizeString(req.body?.deviceId, 191);
    const wrappedAccountKey = normalizeString(req.body?.wrappedAccountKey, 20000);
    const wrappedAccountKeyAlgo =
      normalizeString(req.body?.wrappedAccountKeyAlgo, 120) || 'x25519-xsalsa20poly1305';
    const wrappedAccountKeyVer = Number(req.body?.wrappedAccountKeyVer || 1);

    if (!userId || !deviceId || !wrappedAccountKey) {
      return res.status(400).json({ error: 'deviceId and wrappedAccountKey are required' });
    }

    const existing = await prisma.device.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      select: {
        id: true,
        revokedAt: true,
        pairingStatus: true,
      },
    });

    if (!existing || existing.revokedAt) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const device = await prisma.device.update({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      data: {
        wrappedAccountKey,
        wrappedAccountKeyAlgo,
        wrappedAccountKeyVer: Number.isFinite(wrappedAccountKeyVer)
          ? wrappedAccountKeyVer
          : 1,
        pairingStatus: 'approved',
        pairingApprovedAt: new Date(),
        pairingRejectedAt: null,
      },
      select: deviceSelect,
    });

    return res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.post('/pairing/reject', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);
    const deviceId = normalizeString(req.body?.deviceId, 191);

    if (!userId || !deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const device = await prisma.device.update({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      data: {
        wrappedAccountKey: null,
        wrappedAccountKeyAlgo: null,
        wrappedAccountKeyVer: null,
        pairingStatus: 'rejected',
        pairingRejectedAt: new Date(),
      },
      select: deviceSelect,
    });

    return res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.get('/pairing/status/:deviceId', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);
    const deviceId = normalizeString(req.params.deviceId, 191);

    if (!userId || !deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const device = await prisma.device.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      select: deviceSelect,
    });

    if (!device || device.revokedAt) {
      return res.status(404).json({ error: 'Device not found' });
    }

    return res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const devices = await prisma.device.findMany({
      where: {
          userId,
          revokedAt: null,
          NOT: {
              pairingStatus: 'rejected',
          },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: deviceSelect,
    });

    return res.json({ items: devices });
  } catch (error) {
    next(error);
  }
});

router.get('/user/:userId/public', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.params.userId);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const devices = await prisma.device.findMany({
      where: {
        userId,
        revokedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        deviceId: true,
        name: true,
        platform: true,
        publicKey: true,
        keyAlgorithm: true,
        keyVersion: true,
        isPrimary: true,
      },
    });

    return res.json({ items: devices });
  } catch (error) {
    next(error);
  }
});


router.post('/rename', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const deviceIds =
      normalizeDeviceIds(req.body);

    const name =
      normalizeString(req.body?.name, 120);

    if (
      !userId ||
      deviceIds.length === 0 ||
      !name
    ) {
      return res.status(400).json({
        error:
          'deviceId or deviceIds and name are required',
      });
    }

    const result =
      await prisma.device.updateMany({
        where: {
          userId,
          deviceId: {
            in: deviceIds,
          },
          revokedAt: null,
        },
        data: {
          name,
        },
      });

    if (result.count < 1) {
      return res.status(404).json({
        error: 'Device not found',
      });
    }

    const devices =
      await prisma.device.findMany({
        where: {
          userId,
          deviceId: {
            in: deviceIds,
          },
          revokedAt: null,
        },
        select: deviceSelect,
      });

    return res.json({
      items: devices,
      updatedCount: result.count,
    });
  } catch (error) {
    next(error);
  }
});


router.post('/heartbeat', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);
    const deviceId = normalizeString(req.body?.deviceId, 191);

    if (!userId || !deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const device = await prisma.device.update({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      data: {
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        deviceId: true,
        lastSeenAt: true,
      },
    });

    return res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);
    const deviceId =
      normalizeString(req.body?.deviceId, 191);

    if (!userId || !deviceId) {
      return res.status(400).json({
        error: 'deviceId is required',
        code: 'DEVICE_ID_REQUIRED',
      });
    }

    /*
     * Logout is not revocation.
     *
     * Keep the device identity, encryption metadata, and pairing state.
     * Remove delivery credentials so a signed-out installation cannot
     * continue receiving messages or incoming-call pushes.
     */
    const result = await prisma.device.updateMany({
      where: {
        userId,
        deviceId,
        revokedAt: null,
      },
      data: {
        pushToken: null,
        pushProvider: null,
        apnsPushToken: null,
        apnsSandboxPushToken: null,
        fcmPushToken: null,
        voipPushToken: null,
        voipSandboxPushToken: null,

        voiceIdentity: null,
        voiceRegisteredAt: null,
        voiceRegistrationVer: 0,
        voicePushEnvironment: null,

        lastSeenAt: new Date(),
      },
    });

    if (result.count < 1) {
      return res.status(404).json({
        error: 'Active device not found',
        code: 'DEVICE_NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      deviceId,
    });
  } catch (error) {
    next(error);
  }
});


router.post('/revoke', requireAuth, async (req, res, next) => {
  try {
    const userId = Number(req.user.id);

    const deviceIds =
      normalizeDeviceIds(req.body);

    if (
      !userId ||
      deviceIds.length === 0
    ) {
      return res.status(400).json({
        error:
          'deviceId or deviceIds is required',
      });
    }

    const now = new Date();

    const result =
      await prisma.device.updateMany({
        where: {
          userId,
          deviceId: {
            in: deviceIds,
          },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          revokedById: userId,
          isPrimary: false,

          pushToken: null,
          pushProvider: null,
          apnsPushToken: null,
          apnsSandboxPushToken: null,
          fcmPushToken: null,
          voipPushToken: null,
          voipSandboxPushToken: null,

          wrappedAccountKey: null,
          wrappedAccountKeyAlgo: null,
          wrappedAccountKeyVer: null,
        },
      });

    if (result.count < 1) {
      return res.status(404).json({
        error: 'Device not found',
      });
    }

    return res.json({
      deviceIds,
      revokedCount: result.count,
      revokedAt: now,
    });
  } catch (error) {
    next(error);
  }
});


router.post('/push-token', requireAuth, async (req, res) => {
  const userId = Number(req.user?.id);
  const deviceId = normalizeString(req.body?.deviceId, 191);
  const pushToken = normalizeString(req.body?.pushToken, 4096);

  const pushProvider =
    (
      normalizeString(req.body?.pushProvider, 64) ||
      'apns'
    ).toLowerCase();

  const pushEnvironment =
    (
      normalizeString(req.body?.pushEnvironment, 32) ||
      'production'
    ).toLowerCase();

  if (
    ['apns', 'apns_voip'].includes(pushProvider) &&
    !['sandbox', 'production'].includes(pushEnvironment)
  ) {
    return res.status(400).json({
      error:
        'pushEnvironment must be sandbox or production for APNs.',
      code: 'INVALID_PUSH_ENVIRONMENT',
    });
  }

  if (!userId || !deviceId || !pushToken) {
    return res.status(400).json({
      error: 'deviceId and pushToken are required',
    });
  }

  try {
    const existing = await prisma.device.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      select: {
        id: true,
        revokedAt: true,
      },
    });

    if (!existing) {
      return res.status(409).json({
        error:
          'Register this device before registering its push token.',
        code: 'DEVICE_REGISTRATION_REQUIRED',
      });
    }

    if (existing.revokedAt) {
      return res.status(409).json({
        error:
          'This device has been revoked and cannot register a push token.',
        code: 'DEVICE_REVOKED',
      });
    }

    const pushTokenData = {
      lastSeenAt: new Date(),
    };

    if (pushProvider === 'apns_voip') {
      if (pushEnvironment === 'sandbox') {
        pushTokenData.voipSandboxPushToken = pushToken;
      } else {
        pushTokenData.voipPushToken = pushToken;
      }

      pushTokenData.pushProvider = 'apns_voip';
    } else if (pushProvider === 'apns') {
      if (pushEnvironment === 'sandbox') {
        pushTokenData.apnsSandboxPushToken = pushToken;
      } else {
        pushTokenData.apnsPushToken = pushToken;
        pushTokenData.pushToken = pushToken;
        pushTokenData.pushProvider = pushProvider;
      }
    } else if (pushProvider === 'fcm') {
      pushTokenData.fcmPushToken = pushToken;
      pushTokenData.pushToken = pushToken;
      pushTokenData.pushProvider = pushProvider;
    } else {
      pushTokenData.pushToken = pushToken;
      pushTokenData.pushProvider = pushProvider;
    }

    const {
      tokenField,
    } = getPushTokenOwnership(
      pushProvider,
      pushEnvironment
    );

    const device = await prisma.$transaction(
      async (tx) => {
        /*
         * A push token belongs to one app installation. Remove it from
         * every other device/account before assigning it here.
         */
        await tx.device.updateMany({
          where: {
            id: {
              not: existing.id,
            },
            [tokenField]: pushToken,
          },
          data: {
            [tokenField]: null,
          },
        });

        /*
         * Older registrations may hold the same value in pushToken.
         */
        if (tokenField !== 'pushToken') {
          await tx.device.updateMany({
            where: {
              id: {
                not: existing.id,
              },
              pushToken,
            },
            data: {
              pushToken: null,
              pushProvider: null,
            },
          });
        }

        return tx.device.update({
          where: {
            id: existing.id,
          },
          data: pushTokenData,
          select: {
            id: true,
            userId: true,
            deviceId: true,
            name: true,
            platform: true,
            lastSeenAt: true,
            updatedAt: true,
            revokedAt: true,
            pushToken: true,
            pushProvider: true,
            apnsPushToken: true,
            apnsSandboxPushToken: true,
            fcmPushToken: true,
            voipPushToken: true,
            voipSandboxPushToken: true,
          },
        });
      }
    );

    return res.json({
      success: true,
      device,
    });
  } catch (error) {
    console.error('❌ /devices/push-token failed', {
      userId,
      deviceId,
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });

    return res.status(500).json({
      error: 'push-token failed',
      detail: error?.message || 'unknown error',
      code: error?.code || null,
    });
  }
});


export default router;
