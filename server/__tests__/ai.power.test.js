import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---- Set up a global fetch mock BEFORE importing the router ----
const fetchMock = jest.fn();
global.fetch = fetchMock;

// ---- Prisma + middleware mocks ----
const mockPrisma = {
  participant: {
    findFirst: jest.fn(),
  },
  message: {
    findMany: jest.fn(),
  },
};

const mockRequireAuth = jest.fn((req, _res, next) => {
  // Simulate an authenticated user
  req.user = { id: 1 };
  next();
});

const mockRequirePremium = jest.fn((_req, _res, next) => next());

// ---- Mock modules BEFORE importing the router ----
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

await jest.unstable_mockModule('../middleware/requirePremium.js', () => ({
  __esModule: true,
  requirePremium: mockRequirePremium,
}));

// Import the router under test
const aiRouter = (await import('../routes/ai.power.js')).default;

// Helper to build an Express app
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/ai', aiRouter);

  // Boom-aware error handler
  app.use((err, _req, res, _next) => {
    if (err?.isBoom && err.output) {
      return res
        .status(err.output.statusCode)
        .json({ message: err.message });
    }
    return res.status(500).json({ message: err.message });
  });

  return app;
}

describe('AI power routes', () => {
  let app;

  // ❌ remove this, it races with module import
  // beforeAll(() => {
  //   process.env.OPENAI_API_KEY = 'test-key';
  // });

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('POST /ai/summarize-thread', () => {
    it('summarizes a thread when user is a participant', async () => {
      // User is participant in room 123
      mockPrisma.participant.findFirst.mockResolvedValue({ id: 10 });

      // Last messages in the room
      mockPrisma.message.findMany.mockResolvedValue([
        { rawContent: 'Hello', senderId: 1 },
        { rawContent: 'How are you?', senderId: 2 },
      ]);

      // LLM summary response
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [
            { message: { content: '• Summary line 1\n• Summary line 2' } },
          ],
        }),
        text: async () => '',
      });

      const res = await request(app)
        .post('/ai/summarize-thread')
        .send({ chatRoomId: 123, limit: 50, language: 'en' })
        .expect(200);

      // Participant lookup
      expect(mockPrisma.participant.findFirst).toHaveBeenCalledWith({
        where: { chatRoomId: 123, userId: 1 },
      });

      // Messages query
      expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
        where: { chatRoomId: 123 },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { rawContent: true, senderId: true },
      });

      // Fetch call to OpenAI
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(options.method).toBe('POST');
      // ✅ Just ensure we send a Bearer token, not the exact key
      expect(options.headers.Authorization).toMatch(/^Bearer\s+\S+$/);

      const body = JSON.parse(options.body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.max_tokens).toBe(400);
      expect(body.messages[0]).toEqual({
        role: 'system',
        content:
          'Summarize the conversation in en. Bullet points. Keep it under 12 lines.',
      });

      expect(res.body).toEqual({
        ok: true,
        summary: '• Summary line 1\n• Summary line 2',
      });
    });

    it('returns 403 when user is not a participant', async () => {
      mockPrisma.participant.findFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/ai/summarize-thread')
        .send({ chatRoomId: 999 })
        .expect(403);

      expect(res.body).toEqual({ error: 'Forbidden' });
      expect(mockPrisma.message.findMany).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 when chatRoomId is missing', async () => {
      const res = await request(app)
        .post('/ai/summarize-thread')
        .send({})
        .expect(400);

      expect(res.body).toEqual({ message: 'chatRoomId required' });
      expect(mockPrisma.participant.findFirst).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('POST /ai/rewrite', () => {
    it('rewrites a draft in the given style', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          choices: [
            { message: { content: 'Rewritten friendly text.' } },
          ],
        }),
        text: async () => '',
      });

      const res = await request(app)
        .post('/ai/rewrite')
        .send({
          draft: 'Please rewrite this.',
          style: 'friendly',
        })
        .expect(200);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');

      const body = JSON.parse(options.body);
      expect(body.max_tokens).toBe(300);
      expect(body.messages[0]).toEqual({
        role: 'system',
        content:
          "Rewrite the user's draft in a friendly style. Keep meaning. Output only the rewritten text.",
      });
      expect(body.messages[1]).toEqual({
        role: 'user',
        content: 'Please rewrite this.',
      });

      expect(res.body).toEqual({
        ok: true,
        text: 'Rewritten friendly text.',
      });
    });

    it('returns 400 when draft is missing', async () => {
      const res = await request(app)
        .post('/ai/rewrite')
        .send({})
        .expect(400);

      expect(res.body).toEqual({ message: 'draft required' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
