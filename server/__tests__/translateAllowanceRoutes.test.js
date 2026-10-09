import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
} from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  participant: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

const mockTranslateText = jest.fn();
const mockCountTranslationCharacters = jest.fn((value) =>
  Array.from(String(value ?? '')).length
);
const mockWithTranslationAllowance = jest.fn(
  async ({ operation }) => operation()
);

const mockRequireAuth = jest.fn((req, res, next) => {
  if (req.get('x-test-auth') !== 'yes') {
    return res.status(401).json({ error: 'unauthorized' });
  }

  req.user = {
    id: 123,
    plan: 'PLUS',
  };

  next();
});

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

await jest.unstable_mockModule(
  '../services/translation/googleTranslate.js',
  () => ({
    __esModule: true,
    translateText: mockTranslateText,
  }),
);

await jest.unstable_mockModule(
  '../services/translation/translationUsageService.js',
  () => ({
    __esModule: true,
    countTranslationCharacters: mockCountTranslationCharacters,
    withTranslationAllowance: mockWithTranslationAllowance,
  }),
);

const translateRouter =
  (await import('../routes/translate.js')).default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/translate', translateRouter);

  app.use((err, _req, res, _next) => {
    if (err?.isBoom && err.output) {
      return res
        .status(err.output.statusCode)
        .json({
          message: err.message,
          code: err?.code || null,
        });
    }

    return res
      .status(Number(err?.status) || 500)
      .json({
        message: err?.message || 'Internal Server Error',
        code: err?.code || null,
        limit: err?.limit ?? null,
        used: err?.used ?? null,
        remaining: err?.remaining ?? null,
      });
  });

  return app;
}

describe('translate allowance routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = makeApp();

    mockPrisma.user.findUnique.mockResolvedValue({
      plan: 'PLUS',
    });

    mockPrisma.participant.findFirst.mockResolvedValue({
      userId: 123,
    });

    mockTranslateText.mockResolvedValue({
      translated: 'hola',
      provider: 'google',
    });
  });

  test('POST /translate/test requires authentication', async () => {
    const res = await request(app)
      .post('/translate/test')
      .send({
        text: 'Hello',
        targetLang: 'es',
      })
      .expect(401);

    expect(res.body).toEqual({
      error: 'unauthorized',
    });

    expect(mockTranslateText).not.toHaveBeenCalled();
    expect(mockWithTranslationAllowance).not.toHaveBeenCalled();
  });

  test('POST /translate/test meters translation characters for authenticated user', async () => {
    const res = await request(app)
      .post('/translate/test')
      .set('x-test-auth', 'yes')
      .send({
        text: 'Hello',
        targetLang: 'ES',
      })
      .expect(200);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: { plan: true },
    });

    expect(mockCountTranslationCharacters).toHaveBeenCalledWith(
      'Hello',
    );

    expect(mockWithTranslationAllowance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 123,
        plan: 'PLUS',
        amount: 5,
        operation: expect.any(Function),
        shouldBillResult: expect.any(Function),
      }),
    );

    expect(mockTranslateText).toHaveBeenCalledWith(
      'Hello',
      'es',
    );

    expect(res.body).toEqual({
      original: 'Hello',
      translated: 'hola',
    });
  });

  test('POST /translate/message-preview propagates allowance exhaustion instead of partial 200', async () => {
    const allowanceError = Object.assign(
      new Error('Plan allowance exceeded'),
      {
        status: 429,
        code: 'PLAN_ALLOWANCE_EXCEEDED',
        limit: 100000,
        used: 99998,
        remaining: 2,
      },
    );

    mockWithTranslationAllowance.mockRejectedValueOnce(
      allowanceError,
    );

    const res = await request(app)
      .post('/translate/message-preview')
      .set('x-test-auth', 'yes')
      .send({
        chatRoomId: 77,
        text: 'Hello',
        targetLangs: ['es', 'fr'],
      })
      .expect(429);

    expect(mockPrisma.participant.findFirst).toHaveBeenCalledWith({
      where: {
        chatRoomId: 77,
        userId: 123,
      },
      select: {
        userId: true,
      },
    });

    expect(mockWithTranslationAllowance).toHaveBeenCalledTimes(1);

    expect(res.body).toEqual({
      message: 'Plan allowance exceeded',
      code: 'PLAN_ALLOWANCE_EXCEEDED',
      limit: 100000,
      used: 99998,
      remaining: 2,
    });

    expect(mockTranslateText).not.toHaveBeenCalled();
  });
});
