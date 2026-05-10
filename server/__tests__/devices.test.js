import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prismaMock = {
  device: {
    count: jest.fn(),
    upsert: jest.fn(),
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
    req.user = { id: 1, role: 'USER' };
    next();
  },
}));

const { default: devicesRouter } = await import('../routes/devices.js');

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

describe('Device limit', () => {
  let app;

  beforeEach(() => {
    app = makeApp();

    jest.clearAllMocks();

    prismaMock.user.findUnique.mockResolvedValue({
      plan: 'FREE',
    });
  });

  test('second device for FREE returns 402', async () => {
    prismaMock.device.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    prismaMock.device.upsert.mockResolvedValueOnce({
      id: 1,
      userId: 1,
      deviceId: 'device-laptop',
      name: 'Laptop',
      platform: 'Web',
      publicKey: 'mock-public-key-1',
      keyAlgorithm: 'curve25519',
      keyVersion: 1,
      isPrimary: false,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      revokedAt: null,
    });

    const first = await request(app).post('/devices/register').send({
      deviceId: 'device-laptop',
      name: 'Laptop',
      platform: 'Web',
      publicKey: 'mock-public-key-1',
    });

    expect(first.status).toBe(200);

    expect(prismaMock.device.upsert).toHaveBeenCalledTimes(1);

    const second = await request(app).post('/devices/register').send({
      deviceId: 'device-desktop',
      name: 'Desktop',
      platform: 'Web',
      publicKey: 'mock-public-key-2',
    });

    expect(second.status).toBe(402);

    expect(second.body).toEqual({
      error: 'FREE plan allows one active device. Upgrade to add more devices.',
      code: 'DEVICE_LIMIT_REACHED',
    });

    expect(prismaMock.device.count).toHaveBeenCalledTimes(2);
    expect(prismaMock.device.upsert).toHaveBeenCalledTimes(1);
  });
});