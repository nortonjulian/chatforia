import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Prisma mock --- //
const prismaMock = {
  familyMember: {
    findFirst: jest.fn(),
  },
  mobileDataPackPurchase: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: prismaMock,
}));

// Import router after mocks are set up
const { default: wirelessRouter } = await import('../routes/wireless.js');

function makeApp({ withUser = true } = {}) {
  const app = express();
  app.use(express.json());
  if (withUser) {
    app.use((req, _res, next) => {
      // Default user; tests can override by mutating req headers & checking in middleware
      req.user = { id: 123 };
      next();
    });
  }
  app.use('/api/wireless', wirelessRouter);
  return app;
}

describe('wireless routes', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';

    prismaMock.familyMember.findFirst.mockReset();
    prismaMock.mobileDataPackPurchase.findFirst.mockReset();
    prismaMock.mobileDataPackPurchase.update.mockReset();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ---------------- GET /status ---------------- //

  it('returns 401 when user is not authenticated', async () => {
    const app = makeApp({ withUser: false }); // no req.user at all

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns FAMILY mode status when user is in a family with data', async () => {
    const app = makeApp();

    const now = new Date();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + threeDaysMs).toISOString();

    prismaMock.familyMember.findFirst.mockResolvedValue({
      userId: 123,
      familyId: 1,
      family: {
        id: 1,
        name: 'My Fam',
        totalDataMb: 2000,
        usedDataMb: 500,
        expiresAt,
      },
    });

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('FAMILY');
    expect(res.body.state).toBe('OK');
    expect(res.body.low).toBe(false);
    expect(res.body.exhausted).toBe(false);
    expect(res.body.expired).toBe(false);

    expect(res.body.source).toMatchObject({
      type: 'FAMILY_POOL',
      familyId: 1,
      name: 'My Fam',
      totalDataMb: 2000,
      usedDataMb: 500,
      remainingDataMb: 1500,
      expiresAt,
    });

    // daysRemaining should be about 3 – exact match because we used exact +3 days
    expect(res.body.source.daysRemaining).toBe(3);

    // Should not query individual packs in this branch
    expect(prismaMock.mobileDataPackPurchase.findFirst).not.toHaveBeenCalled();
  });

  it('returns INDIVIDUAL mode with active pack when no family membership', async () => {
    const app = makeApp();

    const now = new Date();
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + fiveDaysMs).toISOString();

    // No family
    prismaMock.familyMember.findFirst.mockResolvedValue(null);

    // First mobileDataPackPurchase.findFirst call is from getActiveIndividualPack
    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue({
      id: 10,
      userId: 123,
      addonKind: 'ESIM_STARTER',
      totalDataMb: 1000,
      remainingDataMb: 300,
      expiresAt,
      createdAt: now.toISOString(),
    });

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('INDIVIDUAL');
    expect(res.body.state).toBe('OK');
    expect(res.body.low).toBe(false);
    expect(res.body.exhausted).toBe(false);
    expect(res.body.expired).toBe(false);

    expect(res.body.source).toMatchObject({
      type: 'ESIM_PACK',
      id: 10,
      addonKind: 'ESIM_STARTER',
      totalDataMb: 1000,
      remainingDataMb: 300,
      expiresAt,
    });

    expect(res.body.source.daysRemaining).toBe(5);

    // getActiveIndividualPack should have been called once
    expect(prismaMock.mobileDataPackPurchase.findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns INDIVIDUAL exhausted/expired status from last pack when no active pack', async () => {
    const app = makeApp();

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    prismaMock.familyMember.findFirst.mockResolvedValue(null);

    // First call: getActiveIndividualPack => no active pack
    prismaMock.mobileDataPackPurchase.findFirst
      .mockResolvedValueOnce(null) // getActiveIndividualPack
      .mockResolvedValueOnce({
        // lastPack
        id: 20,
        userId: 123,
        addonKind: 'ESIM_TRAVELER',
        totalDataMb: 1000,
        remainingDataMb: 0,
        expiresAt: oneDayAgo,
        createdAt: oneDayAgo,
      });

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('INDIVIDUAL');
    expect(res.body.state).toBe('EXPIRED');
    expect(res.body.exhausted).toBe(true);
    expect(res.body.expired).toBe(true);

    expect(res.body.source).toMatchObject({
      type: 'ESIM_PACK',
      id: 20,
      addonKind: 'ESIM_TRAVELER',
      totalDataMb: 1000,
      remainingDataMb: 0,
      expiresAt: oneDayAgo,
    });

    // daysRemaining should be 0 because expiresAt is in the past
    expect(res.body.source.daysRemaining).toBe(0);

    expect(prismaMock.mobileDataPackPurchase.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns NONE when no family and no individual packs at all', async () => {
    const app = makeApp();

    prismaMock.familyMember.findFirst.mockResolvedValue(null);
    prismaMock.mobileDataPackPurchase.findFirst
      .mockResolvedValueOnce(null) // getActiveIndividualPack
      .mockResolvedValueOnce(null); // lastPack

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'NONE', state: 'NONE' });
  });

  it('returns 500 on unexpected error', async () => {
    const app = makeApp();

    prismaMock.familyMember.findFirst.mockRejectedValue(new Error('DB failure'));

    const res = await request(app).get('/api/wireless/status');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to load wireless status' });
  });

  // ---------------- POST /debug/consume ---------------- //

  it('returns 403 in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = makeApp();

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Not available in production' });
  });

  it('returns 401 when user not authenticated for debug consume', async () => {
    const app = makeApp({ withUser: false });

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 50 });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 when mb is invalid', async () => {
    const app = makeApp();

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 0 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'mb must be > 0' });
  });

  it('returns 400 when there is no active individual pack to consume from', async () => {
    const app = makeApp();

    // getActiveIndividualPack -> prisma.mobileDataPackPurchase.findFirst
    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No active individual pack to consume from' });
  });

  it('consumes from active pack and updates remainingDataMb', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue({
      id: 30,
      userId: 123,
      addonKind: 'ESIM_POWER',
      totalDataMb: 1000,
      remainingDataMb: 600,
      expiresAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });

    prismaMock.mobileDataPackPurchase.update.mockResolvedValue({
      id: 30,
      remainingDataMb: 500, // 600 - 100
    });

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(prismaMock.mobileDataPackPurchase.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.mobileDataPackPurchase.update).toHaveBeenCalledWith({
      where: { id: 30 },
      data: { remainingDataMb: 500 },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      id: 30,
      remainingDataMb: 500,
    });
  });

  it('handles errors in debug consume with 500', async () => {
    const app = makeApp();

    prismaMock.mobileDataPackPurchase.findFirst.mockResolvedValue({
      id: 40,
      userId: 123,
      remainingDataMb: 300,
    });

    prismaMock.mobileDataPackPurchase.update.mockRejectedValue(
      new Error('Update failed'),
    );

    const res = await request(app)
      .post('/api/wireless/debug/consume')
      .send({ mb: 100 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to consume data' });
  });
});
