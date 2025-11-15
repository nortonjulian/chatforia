/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---- mocks ----
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockUsage = {
  addUsageSeconds: jest.fn(),
  getUsageSeconds: jest.fn(),
};

// prisma client
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  default: mockPrisma,
}));

// auth middleware -> always "authenticated" as user id 1
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 1 };
    next();
  },
}));

// premium middleware -> just pass through (we’re not testing it here)
await jest.unstable_mockModule('../middleware/requirePremium.js', () => ({
  requirePremium: (_req, _res, next) => next(),
}));

// STT usage helpers
await jest.unstable_mockModule('../services/stt/usage.js', () => mockUsage);

// STT service (not exercised in these tests, but router imports it)
await jest.unstable_mockModule('../services/stt/index.js', () => ({
  transcribeFromUrl: jest.fn(),
}));

// a11y config
await jest.unstable_mockModule('../config/a11yConfig.js', () => ({
  a11yConfig: {
    FREE_STT_MIN_PER_DAY: 0,      // use monthly quota
    FREE_STT_MIN_PER_MONTH: 10,   // 10 minutes per month
    FREE_STT_LANGS: ['en-US'],
  },
}));

// after mocks, import router
const a11yModule = await import('../routes/a11y.js');
const a11yRouter = a11yModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/a11y', a11yRouter);
  return app;
}

describe('a11y routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('PATCH /users/me/a11y', () => {
    test('400 when no valid fields are provided', async () => {
      const res = await request(app)
        .patch('/a11y/users/me/a11y')
        .send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'No valid accessibility fields provided',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    test('402 when enabling live captions for FREE user', async () => {
      // User is FREE plan when checking live captions
      mockPrisma.user.findUnique.mockResolvedValueOnce({ plan: 'FREE' });

      const res = await request(app)
        .patch('/a11y/users/me/a11y')
        .send({ a11yLiveCaptions: true });

      expect(res.statusCode).toBe(402);
      expect(res.body).toEqual({ error: 'Premium required' });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      // prisma.user.findUnique should have been called with current user
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { plan: true },
      });
    });

    test('200 and updates fields for valid body (Premium user)', async () => {
      // First call: checking plan for live captions
      mockPrisma.user.findUnique.mockResolvedValueOnce({ plan: 'PREMIUM' });

      const updatedUser = {
        id: 1,
        a11yUiFont: 'lg',
        a11yVisualAlerts: true,
        a11yVibrate: false,
        a11yFlashOnCall: true,
        a11yLiveCaptions: true,
        a11yVoiceNoteSTT: true,
        a11yCaptionFont: 'md',
        a11yCaptionBg: 'dark',
      };

      mockPrisma.user.update.mockResolvedValue(updatedUser);

      const body = {
        a11yUiFont: 'lg',
        a11yCaptionFont: 'md',
        a11yCaptionBg: 'dark',
        a11yVisualAlerts: 1,     // truthy -> true
        a11yVibrate: 0,          // falsy -> false
        a11yFlashOnCall: true,
        a11yVoiceNoteSTT: 'yes', // truthy -> true
        a11yLiveCaptions: true,
      };

      const res = await request(app)
        .patch('/a11y/users/me/a11y')
        .send(body);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        user: updatedUser,
      });

      // plan check for live captions
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { plan: true },
      });

      // ensure we sent the right updates to prisma
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          a11yUiFont: 'lg',
          a11yCaptionFont: 'md',
          a11yCaptionBg: 'dark',
          a11yVisualAlerts: true,
          a11yVibrate: false,
          a11yFlashOnCall: true,
          a11yVoiceNoteSTT: true,
          a11yLiveCaptions: true,
        },
        select: {
          id: true,
          a11yUiFont: true,
          a11yVisualAlerts: true,
          a11yVibrate: true,
          a11yFlashOnCall: true,
          a11yLiveCaptions: true,
          a11yVoiceNoteSTT: true,
          a11yCaptionFont: true,
          a11yCaptionBg: true,
        },
      });
    });
  });

  describe('GET /users/me/a11y/quota', () => {
    test('returns quota summary for FREE user with usage', async () => {
      // computeQuota: user plan + usage seconds
      mockPrisma.user.findUnique.mockResolvedValueOnce({ plan: 'FREE' });
      mockUsage.getUsageSeconds.mockResolvedValueOnce(120); // 2 minutes used

      const res = await request(app).get('/a11y/users/me/a11y/quota');

      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);

      const { quota } = res.body;
      // perMonthMin = 10 => budgetSec = 600
      expect(quota).toEqual({
        plan: 'FREE',
        period: 'month',
        usedSec: 120,
        remainingSec: 480,
        budgetSec: 600,
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: { plan: true },
      });
      expect(mockUsage.getUsageSeconds).toHaveBeenCalledWith(1, {
        period: 'month',
      });
    });
  });
});
