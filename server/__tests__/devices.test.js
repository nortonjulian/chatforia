import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prismaMock = {
  $transaction: jest.fn(),
  device: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 1,
      role: 'USER',
    };

    next();
  },
}));

const { default: devicesRouter } =
  await import('../routes/devices.js');

function makeApp() {
  const app = express();

  app.use('/devices', devicesRouter);

  app.use((err, _req, res, _next) => {
    return res.status(500).json({
      error: err?.message || 'Internal Server Error',
    });
  });

  return app;
}

function makeDevice(overrides = {}) {
  return {
    id: 'database-device-1',
    userId: 1,
    deviceId: 'device-new',
    name: 'Android Device',
    platform: 'Android',
    publicKey: 'mock-public-key',
    keyAlgorithm: 'curve25519',
    keyVersion: 1,
    isPrimary: false,
    lastSeenAt: new Date('2026-07-20T20:00:00.000Z'),
    createdAt: new Date('2026-07-20T20:00:00.000Z'),
    updatedAt: new Date('2026-07-20T20:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

describe('Device registration and replacement', () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();

    app = makeApp();

    prismaMock.$transaction.mockImplementation(
      async (callback) => callback(prismaMock)
    );

    prismaMock.user.findUnique.mockResolvedValue({
      plan: 'FREE',
    });
  });

  test('FREE user registers when no active device exists', async () => {
    prismaMock.device.findMany.mockResolvedValue([]);

    prismaMock.device.upsert.mockResolvedValue(
      makeDevice()
    );

    const response = await request(app)
      .post('/devices/register')
      .send({
        deviceId: 'device-new',
        name: 'Android Device',
        platform: 'Android',
        publicKey: 'mock-public-key',
      });

    expect(response.status).toBe(200);
    expect(response.body.device.deviceId).toBe('device-new');
    expect(response.body.replacedDeviceIds).toEqual([]);

    expect(prismaMock.device.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.device.upsert).toHaveBeenCalledTimes(1);
  });

  test('FREE reinstall requires replacement confirmation', async () => {
    prismaMock.device.findMany.mockResolvedValue([
      {
        deviceId: 'device-old',
        name: 'Old Android Device',
        platform: 'Android',
        lastSeenAt: new Date('2026-07-19T20:00:00.000Z'),
        createdAt: new Date('2026-07-18T20:00:00.000Z'),
      },
    ]);

    const response = await request(app)
      .post('/devices/register')
      .send({
        deviceId: 'device-new',
        name: 'Android Device',
        platform: 'Android',
        publicKey: 'mock-public-key',
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      'DEVICE_REPLACEMENT_REQUIRED'
    );

    expect(response.body.existingDevices).toEqual([
      expect.objectContaining({
        deviceId: 'device-old',
        name: 'Old Android Device',
        platform: 'Android',
      }),
    ]);

    expect(prismaMock.device.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.device.upsert).not.toHaveBeenCalled();
  });

  test('confirmed FREE replacement revokes old device and registers new one', async () => {
    prismaMock.device.findMany.mockResolvedValue([
      {
        deviceId: 'device-old',
        name: 'Old Android Device',
        platform: 'Android',
        lastSeenAt: new Date('2026-07-19T20:00:00.000Z'),
        createdAt: new Date('2026-07-18T20:00:00.000Z'),
      },
    ]);

    prismaMock.device.updateMany.mockResolvedValue({
      count: 1,
    });

    prismaMock.device.upsert.mockResolvedValue(
      makeDevice()
    );

    const response = await request(app)
      .post('/devices/register')
      .send({
        deviceId: 'device-new',
        name: 'Android Device',
        platform: 'Android',
        publicKey: 'mock-public-key',
        replaceExistingDevice: true,
        replaceDeviceId: 'device-old',
      });

    expect(response.status).toBe(200);
    expect(response.body.device.deviceId).toBe('device-new');
    expect(response.body.replacedDeviceIds).toEqual([
      'device-old',
    ]);

    expect(prismaMock.device.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 1,
        deviceId: {
          not: 'device-new',
        },
        revokedAt: null,
      },
      data: expect.objectContaining({
        revokedById: 1,
        pushToken: null,
        pushProvider: null,
        apnsPushToken: null,
        fcmPushToken: null,
        voipPushToken: null,
      }),
    });

    expect(prismaMock.device.upsert).toHaveBeenCalledTimes(1);
  });

  test('stale replacement target is rejected', async () => {
    prismaMock.device.findMany.mockResolvedValue([
      {
        deviceId: 'device-current',
        name: 'Current Device',
        platform: 'Android',
        lastSeenAt: new Date('2026-07-20T20:00:00.000Z'),
        createdAt: new Date('2026-07-20T19:00:00.000Z'),
      },
    ]);

    const response = await request(app)
      .post('/devices/register')
      .send({
        deviceId: 'device-new',
        name: 'Android Device',
        platform: 'Android',
        publicKey: 'mock-public-key',
        replaceExistingDevice: true,
        replaceDeviceId: 'device-no-longer-active',
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      'DEVICE_REPLACEMENT_TARGET_STALE'
    );

    expect(prismaMock.device.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.device.upsert).not.toHaveBeenCalled();
  });

  test('paid user can add another device without replacement', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      plan: 'PREMIUM',
    });

    prismaMock.device.findMany.mockResolvedValue([
      {
        deviceId: 'device-existing',
        name: 'Existing Device',
        platform: 'iOS',
        lastSeenAt: new Date('2026-07-20T20:00:00.000Z'),
        createdAt: new Date('2026-07-19T20:00:00.000Z'),
      },
    ]);

    prismaMock.device.upsert.mockResolvedValue(
      makeDevice()
    );

    const response = await request(app)
      .post('/devices/register')
      .send({
        deviceId: 'device-new',
        name: 'Android Device',
        platform: 'Android',
        publicKey: 'mock-public-key',
      });

    expect(response.status).toBe(200);
    expect(response.body.replacedDeviceIds).toEqual([]);

    expect(prismaMock.device.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.device.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('Push-token registration', () => {
  let app;

  beforeEach(() => {
    jest.resetAllMocks();
    app = makeApp();
  });

  test('unregistered device cannot register a push token', async () => {
    prismaMock.device.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .post('/devices/push-token')
      .send({
        deviceId: 'device-new',
        pushToken: 'mock-fcm-token',
        pushProvider: 'fcm',
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe(
      'DEVICE_REGISTRATION_REQUIRED'
    );

    expect(prismaMock.device.update).not.toHaveBeenCalled();
  });

  test('revoked device cannot register a push token', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      id: 'database-device-old',
      revokedAt: new Date('2026-07-20T20:00:00.000Z'),
    });

    const response = await request(app)
      .post('/devices/push-token')
      .send({
        deviceId: 'device-old',
        pushToken: 'mock-fcm-token',
        pushProvider: 'fcm',
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DEVICE_REVOKED');

    expect(prismaMock.device.update).not.toHaveBeenCalled();
  });

  test('active device can update its FCM token without changing revokedAt', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      id: 'database-device-1',
      revokedAt: null,
    });

    prismaMock.device.update.mockResolvedValue({
      id: 'database-device-1',
      userId: 1,
      deviceId: 'device-new',
      name: 'Android Device',
      platform: 'Android',
      lastSeenAt: new Date('2026-07-20T20:00:00.000Z'),
      updatedAt: new Date('2026-07-20T20:00:00.000Z'),
      revokedAt: null,
      pushToken: 'mock-fcm-token',
      pushProvider: 'fcm',
      apnsPushToken: null,
      fcmPushToken: 'mock-fcm-token',
      voipPushToken: null,
    });

    const response = await request(app)
      .post('/devices/push-token')
      .send({
        deviceId: 'device-new',
        pushToken: 'mock-fcm-token',
        pushProvider: 'fcm',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    expect(prismaMock.device.update).toHaveBeenCalledWith({
      where: {
        id: 'database-device-1',
      },
      data: {
        lastSeenAt: expect.any(Date),
        fcmPushToken: 'mock-fcm-token',
        pushToken: 'mock-fcm-token',
        pushProvider: 'fcm',
      },
      select: expect.any(Object),
    });

    const updateCall =
      prismaMock.device.update.mock.calls[0][0];

    expect(updateCall.data).not.toHaveProperty('revokedAt');
    expect(updateCall.data).not.toHaveProperty('revokedById');
  });
});
