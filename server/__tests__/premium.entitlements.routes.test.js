/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const findUniqueMock = jest.fn();
const getUsageSummaryMock = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: {
    user: {
      findUnique: findUniqueMock,
    },
  },
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 42,
      username: 'tester',
      plan: 'PLUS',
    };
    next();
  },
}));

await jest.unstable_mockModule('../middleware/requirePremium.js', () => ({
  requirePremium: (_req, _res, next) => next(),
}));

await jest.unstable_mockModule('../services/planUsageService.js', () => ({
  getUsageSummary: getUsageSummaryMock,
}));

const premiumModule = await import('../routes/premium.js');
const premiumRouter = premiumModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/premium', premiumRouter);
  return app;
}

describe('premium entitlements route', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  test('returns plan entitlements and monthly usage while preserving serialized legacy fields', async () => {
    findUniqueMock.mockResolvedValue({ plan: 'PLUS' });

    const entitlements = {
      riaActions: 200,
      translationChars: 100_000,
      hostedParticipantMinutes: 300,
      smsMessages: 250,
      pstnMinutes: 100,
      forwardingMinutes: 100,
      voicemailTranscriptionMinutes: 0,
      cloudStorageBytes: 15 * 1024 ** 3,
      messageHistoryDays: null,
      adsEnabled: false,
      aiRewriteLevel: 'STANDARD',
      supportLevel: 'EMAIL',
    };

    const usage = {
      riaActions: {
        used: 17,
        limit: 200,
        remaining: 183,
      },
      translationChars: {
        used: 1_400,
        limit: 100_000,
        remaining: 98_600,
      },
    };

    getUsageSummaryMock.mockResolvedValue({
      plan: 'PLUS',
      monthKey: '2026-10',
      entitlements,
      usage,
    });

    const res = await request(app).get('/premium/entitlements');

    expect(res.statusCode).toBe(200);
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 42 },
      select: { plan: true },
    });
    expect(getUsageSummaryMock).toHaveBeenCalledWith(42, 'PLUS');

    expect(res.body).toEqual(
      expect.objectContaining({
        plan: 'PLUS',
        monthKey: '2026-10',
        entitlements,
        usage,
        deviceLimit: expect.any(Number),
        expireMaxDays: expect.any(Number),
        tones: expect.any(Object),
      }),
    );
  });

  test('falls back to FREE when the user has no stored plan', async () => {
    findUniqueMock.mockResolvedValue(null);

    getUsageSummaryMock.mockResolvedValue({
      plan: 'FREE',
      monthKey: '2026-10',
      entitlements: {
        riaActions: 20,
      },
      usage: {
        riaActions: {
          used: 0,
          limit: 20,
          remaining: 20,
        },
      },
    });

    const res = await request(app).get('/premium/entitlements');

    expect(res.statusCode).toBe(200);
    expect(getUsageSummaryMock).toHaveBeenCalledWith(42, 'FREE');
    expect(res.body.plan).toBe('FREE');
    expect(res.body.entitlements.riaActions).toBe(20);
    expect(res.body.usage.riaActions).toEqual({
      used: 0,
      limit: 20,
      remaining: 20,
    });
  });
});
