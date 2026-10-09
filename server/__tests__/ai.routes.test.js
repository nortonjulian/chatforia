/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ----- mocks -----

let mockPlan = 'PREMIUM';

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 1,
      username: 'tester',
      displayName: 'Tester',
      plan: mockPlan,
    };
    next();
  },
}));

await jest.unstable_mockModule('../middleware/blockWhenStrictE2EE.js', () => ({
  default: (_req, _res, next) => next(),
}));

const suggestRepliesMock = jest.fn();
const rewriteTextMock = jest.fn();
const chatWithRiaMock = jest.fn();

await jest.unstable_mockModule('../services/riaService.js', () => ({
  suggestReplies: suggestRepliesMock,
  rewriteText: rewriteTextMock,
  chatWithRia: chatWithRiaMock,
}));

const assertAndConsumeUsageMock = jest.fn();
const releaseUsageMock = jest.fn();

await jest.unstable_mockModule('../services/planUsageService.js', () => ({
  assertAndConsumeUsage: assertAndConsumeUsageMock,
  releaseUsage: releaseUsageMock,
}));

const aiModule = await import('../routes/ai.js');
const aiRouter = aiModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);

  app.use((err, _req, res, _next) => {
    const status = err.output?.statusCode || err.statusCode || err.status || 500;
    res.status(status).json({
      error: err.message,
    });
  });

  return app;
}

describe('AI routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
    mockPlan = 'PREMIUM';

    assertAndConsumeUsageMock.mockResolvedValue({
      allowed: true,
      limit: 500,
      used: 1,
      remaining: 499,
    });
    releaseUsageMock.mockResolvedValue(undefined);
  });

  describe('POST /ai/suggest-replies', () => {
    test('delegates to suggestReplies and returns suggestions', async () => {
      const result = {
        suggestions: [{ text: 'Sounds good!' }],
      };

      suggestRepliesMock.mockResolvedValue(result);

      const res = await request(app)
        .post('/ai/suggest-replies')
        .send({
          filterProfanity: true,
          draft: '',
          messages: [
            {
              role: 'user',
              content: 'Hello, can you help?',
            },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(result);

      expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
        userId: 1,
        plan: 'PREMIUM',
        meter: 'riaActions',
        amount: 1,
      });

      expect(suggestRepliesMock).toHaveBeenCalledWith({
        messages: [
          {
            role: 'user',
            content: 'Hello, can you help?',
          },
        ],
        draft: '',
        filterProfanity: true,
      });
    });

    test('allows Chatforia Plus to use smart replies', async () => {
      mockPlan = 'PLUS';

      const result = {
        suggestions: [{ text: 'Sure!' }],
      };
      suggestRepliesMock.mockResolvedValue(result);

      const res = await request(app)
        .post('/ai/suggest-replies')
        .send({
          messages: [{ role: 'user', content: 'Can you help?' }],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(result);
      expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
        userId: 1,
        plan: 'PLUS',
        meter: 'riaActions',
        amount: 1,
      });
      expect(suggestRepliesMock).toHaveBeenCalledTimes(1);
    });

    test('blocks Chatforia Free from smart replies before consuming allowance', async () => {
      mockPlan = 'FREE';

      const res = await request(app)
        .post('/ai/suggest-replies')
        .send({
          messages: [{ role: 'user', content: 'Can you help?' }],
        });

      expect(res.statusCode).toBe(402);
      expect(res.body).toEqual({
        error: 'AI smart replies require Chatforia Plus or Premium',
      });
      expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
      expect(suggestRepliesMock).not.toHaveBeenCalled();
      expect(releaseUsageMock).not.toHaveBeenCalled();
    });

    test('does not call Ria when the monthly allowance is exhausted', async () => {
      const err = new Error('Plan allowance exceeded');
      err.status = 429;
      err.code = 'PLAN_ALLOWANCE_EXCEEDED';
      assertAndConsumeUsageMock.mockRejectedValue(err);

      const res = await request(app)
        .post('/ai/suggest-replies')
        .send({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(res.statusCode).toBe(429);
      expect(suggestRepliesMock).not.toHaveBeenCalled();
      expect(releaseUsageMock).not.toHaveBeenCalled();
    });

    test('releases the reserved action when Ria fails', async () => {
      suggestRepliesMock.mockRejectedValue(new Error('OpenAI failed'));

      const res = await request(app)
        .post('/ai/suggest-replies')
        .send({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(res.statusCode).toBe(500);
      expect(releaseUsageMock).toHaveBeenCalledWith({
        userId: 1,
        meter: 'riaActions',
        amount: 1,
      });
    });
  });

  describe('POST /ai/rewrite', () => {
    test('delegates to rewriteText and returns rewritten text', async () => {
      const result = {
        text: 'Hey! Just checking in.',
      };

      rewriteTextMock.mockResolvedValue(result);

      const res = await request(app)
        .post('/ai/rewrite')
        .send({
          text: 'checking in',
          tone: 'friendly',
          filterProfanity: false,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(result);

      expect(rewriteTextMock).toHaveBeenCalledWith({
        text: 'checking in',
        tone: 'friendly',
        filterProfanity: false,
      });

      expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
      expect(releaseUsageMock).not.toHaveBeenCalled();
    });

    test('allows Chatforia Plus to use standard rewrite', async () => {
      mockPlan = 'PLUS';
      const result = {
        text: 'A cleaner rewrite.',
      };

      rewriteTextMock.mockResolvedValue(result);

      const res = await request(app)
        .post('/ai/rewrite')
        .send({
          text: 'rewrite this',
          tone: 'friendly',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(result);
      expect(rewriteTextMock).toHaveBeenCalledTimes(1);
      expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
    });

    test('blocks Chatforia Free from AI rewrite', async () => {
      mockPlan = 'FREE';

      const res = await request(app)
        .post('/ai/rewrite')
        .send({
          text: 'rewrite this',
          tone: 'friendly',
        });

      expect(res.statusCode).toBe(402);
      expect(res.body).toEqual({
        error: 'AI rewrite requires Chatforia Plus or Premium',
      });
      expect(rewriteTextMock).not.toHaveBeenCalled();
      expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
    });

    test('returns 400 when text is missing', async () => {
      const res = await request(app)
        .post('/ai/rewrite')
        .send({ text: '' });

      expect(res.statusCode).toBe(400);
      expect(rewriteTextMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /ai/chat', () => {
    test('delegates to chatWithRia and returns response', async () => {
      const result = {
        message: 'Hi, I am Ria.',
      };

      chatWithRiaMock.mockResolvedValue(result);

      const res = await request(app)
        .post('/ai/chat')
        .send({
          memoryEnabled: true,
          filterProfanity: false,
          messages: [
            {
              role: 'user',
              content: 'Hello Ria',
            },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(result);

      expect(assertAndConsumeUsageMock).toHaveBeenCalledWith({
        userId: 1,
        plan: 'PREMIUM',
        meter: 'riaActions',
        amount: 1,
      });

      expect(chatWithRiaMock).toHaveBeenCalledWith({
        userId: 1,
        username: 'tester',
        displayName: 'Tester',
        messages: [
          {
            role: 'user',
            content: 'Hello Ria',
          },
        ],
        memoryEnabled: true,
        filterProfanity: false,
      });
    });

    test('releases the reserved action when Ria chat fails', async () => {
      chatWithRiaMock.mockRejectedValue(new Error('OpenAI failed'));

      const res = await request(app)
        .post('/ai/chat')
        .send({ messages: [{ role: 'user', content: 'Hello Ria' }] });

      expect(res.statusCode).toBe(500);
      expect(releaseUsageMock).toHaveBeenCalledWith({
        userId: 1,
        meter: 'riaActions',
        amount: 1,
      });
    });

    test('returns 400 when messages is empty', async () => {
      const res = await request(app)
        .post('/ai/chat')
        .send({ messages: [] });

      expect(res.statusCode).toBe(400);
      expect(chatWithRiaMock).not.toHaveBeenCalled();
      expect(assertAndConsumeUsageMock).not.toHaveBeenCalled();
    });
  });
});