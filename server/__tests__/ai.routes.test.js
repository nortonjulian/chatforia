/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ----- mocks -----

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = {
      id: 1,
      username: 'tester',
      displayName: 'Tester',
      plan: 'PREMIUM',
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

const aiModule = await import('../routes/ai.js');
const aiRouter = aiModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);

  app.use((err, _req, res, _next) => {
    const status = err.output?.statusCode || err.statusCode || 500;
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

    test('returns 400 when messages is empty', async () => {
      const res = await request(app)
        .post('/ai/chat')
        .send({ messages: [] });

      expect(res.statusCode).toBe(400);
      expect(chatWithRiaMock).not.toHaveBeenCalled();
    });
  });
});