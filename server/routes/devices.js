import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import prisma from '../utils/prismaClient.js';
import { sendPushToUser } from '../services/pushService.js';

const router = express.Router();

router.use(express.json());

console.log('✅ NEW devices.js route loaded');

function normalizeString(value, maxLen = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizePairingStatus(value) {
  const v = normalizeString(value, 32)?.toLowerCase();
  if (!v) return null;
  if (v === 'pending' || v === 'approved' || v === 'rejected') return v;
  return null;
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
  console.log('✅ NEW /devices/register hit');
  try {
    const userId = Number(req.user.id);

    const deviceId = normalizeString(req.body?.deviceId, 191);
    const name = normalizeString(req.body?.name, 120) || 'iPhone';
    const platform = normalizeString(req.body?.platform, 120) || 'iOS';
    const publicKey = normalizeString(req.body?.publicKey, 4096);
    const keyAlgorithm = normalizeString(req.body?.keyAlgorithm, 50) || 'curve25519';
    const keyVersion = Number(req.body?.keyVersion || 1);

    if (!userId || !deviceId || !publicKey) {
  return res.status(400).json({ error: 'deviceId and publicKey are required' });
}

    const existingActiveDevices = await prisma.device.count({
      where: {
        userId,
        revokedAt: null,
        NOT: {
          deviceId,
        },
      },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true,
      },
    });

    const plan = String(user?.plan || 'FREE').toUpperCase();
    const isPaidPlan = ['PLUS', 'PREMIUM', 'WIRELESS'].includes(plan);

    if (!isPaidPlan && existingActiveDevices >= 1) {
      return res.status(402).json({
        error: 'FREE plan allows one active device. Upgrade to add more devices.',
        code: 'DEVICE_LIMIT_REACHED',
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
        revokedAt: null,
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
        keyVersion: Number.isFinite(keyVersion) ? keyVersion : 1,
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

    return res.status(200).json({ device });
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
        revokedAt: null,
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

router.post('/revoke', requireAuth, async (req, res, next) => {
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
        revokedAt: new Date(),
        revokedById: userId,
      },
      select: {
        id: true,
        deviceId: true,
        revokedAt: true,
        revokedById: true,
      },
    });

    return res.json({ device });
  } catch (error) {
    next(error);
  }
});

router.post('/push-token', requireAuth, async (req, res) => {
  const userId = Number(req.user?.id);
  const deviceId = normalizeString(req.body?.deviceId, 191);
  const pushToken = normalizeString(req.body?.pushToken, 4096);
  const pushProvider = normalizeString(req.body?.pushProvider, 64) || 'apns';

  const publicKey = normalizeString(req.body?.publicKey, 4096);
  const keyAlgorithm = normalizeString(req.body?.keyAlgorithm, 64) || 'curve25519';
  const keyVersion = Number(req.body?.keyVersion || 1);
  const platform =
    normalizeString(req.body?.platform, 64) ||
    (pushProvider === 'fcm' ? 'Android' : 'iOS');
  const name =
    normalizeString(req.body?.name, 191) ||
    (pushProvider === 'fcm' ? 'Android device' : 'iOS device');

  console.log('📥 /devices/push-token request', {
    userId,
    deviceId,
    pushTokenPreview: pushToken ? `${pushToken.slice(0, 12)}...` : null,
    pushProvider,
    hasPublicKey: Boolean(publicKey),
  });

  if (!userId || !deviceId || !pushToken) {
    return res.status(400).json({ error: 'deviceId and pushToken are required' });
  }

  try {
    const existing = await prisma.device.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
    });

    let device;

    if (existing) {
      device = await prisma.device.update({
        where: {
          userId_deviceId: {
            userId,
            deviceId,
          },
        },
        data: {
          pushToken,
          pushProvider,
          lastSeenAt: new Date(),
          revokedAt: null,
        },
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
        },
      });
    } else {
      if (!publicKey) {
        return res.status(400).json({
          error: 'publicKey is required when creating a new device from push-token',
        });
      }

      device = await prisma.device.create({
        data: {
          userId,
          deviceId,
          pushToken,
          pushProvider,
          publicKey,
          keyAlgorithm,
          keyVersion,
          platform,
          name,
          lastSeenAt: new Date(),
          revokedAt: null,
        },
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
        },
      });
    }

    console.log('✅ /devices/push-token saved', {
      id: device.id,
      userId: device.userId,
      deviceId: device.deviceId,
      platform: device.platform,
      pushProvider: device.pushProvider,
    });

    return res.json({ success: true, device });
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