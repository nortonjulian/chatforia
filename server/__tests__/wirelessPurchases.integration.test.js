import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';

const EXPECTED_DATABASE = 'chatforia_wireless_test_20261013';
const usernamePrefix = 'ZERO-TELNA-PURCHASE-LIST-';
const fetchEsimUsageMock = jest.fn();

jest.unstable_mockModule('../services/providers/esimProvider.js', () => ({
  fetchEsimUsage: fetchEsimUsageMock,
}));
jest.unstable_mockModule('../services/provisioningService.js', () => ({
  createEsimProfileForProvider: jest.fn(),
  handleProviderWebhook: jest.fn(),
}));
jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    const id = Number(req.get('X-Test-User-Id'));
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = { id };
    next();
  },
}));

const { default: wirelessRouter } = await import('../routes/wireless.js');

function assertDisposableDatabase() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw || process.env.DATABASE_URL !== raw) {
    throw new Error('A selected test database is required');
  }
  const url = new URL(raw);
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '65444' ||
    url.pathname !== `/${EXPECTED_DATABASE}`
  ) {
    throw new Error(
      'SAFETY ABORT: expected the disposable local eSIM database'
    );
  }
}

describe('purchased data packages PostgreSQL integration — ZERO TELNA', () => {
  let prisma;
  let owner;
  let other;

  beforeAll(async () => {
    assertDisposableDatabase();
    prisma = new PrismaClient();
    owner = await prisma.user.create({
      data: {
        username: `${usernamePrefix}OWNER`,
        passwordHash: 'fixture-only',
      },
    });
    other = await prisma.user.create({
      data: {
        username: `${usernamePrefix}OTHER`,
        passwordHash: 'fixture-only',
      },
    });

    await prisma.subscriber.create({
      data: {
        userId: owner.id,
        provider: 'telna',
        status: 'ACTIVE',
        iccid: 'synthetic-owner-0813',
      },
    });
    await prisma.mobileDataPackPurchase.createMany({
      data: [
        {
          userId: owner.id,
          kind: 'ESIM',
          addonKind: 'chatforia_esim_local_3_premium',
          totalDataMb: 3072,
          remainingDataMb: 3072,
          expiresAt: new Date(Date.now() - 86400000),
          billingTransactionId: 'synthetic-expired-payment',
          iccid: 'synthetic-owner-0813',
          providerPurchaseId: 'mock-expired-package',
        },
        {
          userId: owner.id,
          kind: 'ESIM',
          addonKind: 'chatforia_esim_europe_5_premium',
          totalDataMb: 5120,
          remainingDataMb: 5120,
          expiresAt: new Date(Date.now() + 86400000),
          billingTransactionId: 'synthetic-pending-payment',
        },
        {
          userId: other.id,
          kind: 'ESIM',
          addonKind: 'chatforia_esim_global_10_premium',
          totalDataMb: 10240,
          remainingDataMb: 10240,
          expiresAt: new Date(Date.now() + 86400000),
          billingTransactionId: 'synthetic-other-payment',
          providerPurchaseId: 'mock-other-package',
          iccid: 'synthetic-other-1234',
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const ids = [owner?.id, other?.id].filter(Boolean);
    await prisma.subscriber.deleteMany({ where: { userId: { in: ids } } });
    await prisma.mobileDataPackPurchase.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('returns only the authenticated account’s complete ledger without changing it', async () => {
    const app = express();
    app.use('/api/wireless', wirelessRouter);
    const before = await prisma.mobileDataPackPurchase.findMany({
      where: { userId: owner.id },
      orderBy: { id: 'asc' },
    });

    const res = await request(app)
      .get('/api/wireless/purchases')
      .set('X-Test-User-Id', String(owner.id));

    const after = await prisma.mobileDataPackPurchase.findMany({
      where: { userId: owner.id },
      orderBy: { id: 'asc' },
    });
    expect(res.status).toBe(200);
    expect(res.body.packages).toHaveLength(2);
    expect(res.body.packages.map((item) => item.state).sort()).toEqual([
      'AWAITING_PROVISIONING',
      'EXPIRED',
    ]);
    expect(res.body.replacementEligibility.eligible).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('synthetic-owner-0813');
    expect(JSON.stringify(res.body)).not.toContain('synthetic-other-payment');
    expect(after).toEqual(before);
    expect(fetchEsimUsageMock).not.toHaveBeenCalled();
  });
});
