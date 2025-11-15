/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ----- env for AI routes -----
process.env.AI_PROFANITY_WORDS = 'badword';
process.env.AI_SUGGEST_MAX_INPUT = '4000';
process.env.OPENAI_API_KEY = 'test-key';
process.env.AI_SUGGEST_MODEL = 'gpt-4o-mini';

// ----- mocks -----

// translateText util
const translateTextMock = jest.fn();
await jest.unstable_mockModule('../utils/translateText.js', () => ({
  translateText: translateTextMock,
}));

// auth middleware
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 1, username: 'tester', plan: 'PREMIUM' };
    next();
  },
}));

// premium middleware
await jest.unstable_mockModule('../middleware/requirePremium.js', () => ({
  requirePremium: (_req, _res, next) => next(),
}));

// blockWhenStrictE2EE middleware
await jest.unstable_mockModule('../middleware/blockWhenStrictE2EE.js', () => ({
  default: (_req, _res, next) => next(),
}));

// import router AFTER mocks
const aiModule = await import('../routes/ai.js');
const aiRouter = aiModule.default;

// helper to make an app with the AI router mounted
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);
  return app;
}

describe('AI routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();

    // mock global fetch for OpenAI calls
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              // callOpenAIForSuggestions expects JSON-only content
              content: JSON.stringify({
                suggestions: [{ text: 'This has badword inside' }],
              }),
            },
          },
        ],
      }),
    });
  });

  describe('POST /ai/power-feature', () => {
    test('returns stubbed premium result when user is premium', async () => {
      const res = await request(app).post('/ai/power-feature').send({});

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        result: '✨ Premium AI result (replace with real logic)',
      });
    });
  });

  describe('POST /ai/suggest-replies', () => {
    test('returns suggestions and applies profanity masking when enabled', async () => {
      const body = {
        locale: 'en-US',
        filterProfanity: true,
        snippets: [
          {
            role: 'user',
            author: 'alice',
            text: 'Hello, can you help?',
          },
        ],
      };

      const res = await request(app)
        .post('/ai/suggest-replies')
        .send(body);

      expect(res.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Ensure the OpenAI call got the right payload basics
      const [url, fetchOpts] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const parsedBody = JSON.parse(fetchOpts.body);
      expect(parsedBody.model).toBe('gpt-4o-mini');
      expect(parsedBody.messages[0].role).toBe('system');
      expect(parsedBody.messages[1].role).toBe('user');

      // Suggestions should be present
      expect(res.body).toHaveProperty('suggestions');
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body.suggestions.length).toBeGreaterThan(0);

      const [first] = res.body.suggestions;

      // Profanity should be masked: "badword" -> "b*****d"
      expect(first.text).toContain('b*****d');
      expect(first.text).not.toContain('badword');
    });
  });

  describe('POST /ai/translate', () => {
    test('delegates to translateText and returns its result', async () => {
      const result = {
        text: 'Hola mundo',
        detectedSourceLang: 'en',
        targetLang: 'es',
      };

      translateTextMock.mockResolvedValue(result);

      const body = {
        text: 'Hello world',
        targetLang: 'es',
        sourceLang: 'en',
      };

      const res = await request(app)
        .post('/ai/translate')
        .send(body);

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(result);

      expect(translateTextMock).toHaveBeenCalledWith({
        text: 'Hello world',
        targetLang: 'es',
        sourceLang: 'en',
      });
    });
  });
});
