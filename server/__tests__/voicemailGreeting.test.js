import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- ESM-friendly mocks (must come BEFORE imports of those modules) ---

jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      update: jest.fn(),
    },
  },
}));

jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  // Fake auth: just attach a user with id "123"
  requireAuth: (req, _res, next) => {
    req.user = { id: '123' };
    next();
  },
}));

jest.unstable_mockModule('../utils/storage.js', () => ({
  __esModule: true,
  uploadBufferToStorage: jest.fn(),
}));

// --- Dynamic imports so they see the mocks ---
let prisma;
let uploadBufferToStorage;
let voicemailGreetingRouter;

beforeAll(async () => {
  ({ default: prisma } = await import('../utils/prismaClient.js'));
  ({ uploadBufferToStorage } = await import('../utils/storage.js'));
  ({ default: voicemailGreetingRouter } = await import('../routes/voicemailGreeting.js'));
});

// Helper to build an app with the router mounted
function makeApp() {
  const app = express();
  app.use('/api/voicemail/greeting', voicemailGreetingRouter);
  return app;
}

describe('voicemailGreeting routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/voicemail/greeting returns 400 when file is missing', async () => {
    const app = makeApp();

    const res = await request(app)
      .post('/api/voicemail/greeting')
      // no file attached
      .expect(400);

    expect(res.body).toEqual({ error: 'Missing file' });
    expect(uploadBufferToStorage).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('POST /api/voicemail/greeting uploads file and updates user greetingUrl', async () => {
    const app = makeApp();

    // Mock storage upload
    uploadBufferToStorage.mockResolvedValueOnce(
      'https://cdn.example.com/greeting-123.mp3'
    );

    // Mock prisma update
    prisma.user.update.mockResolvedValueOnce({
      voicemailGreetingUrl: 'https://cdn.example.com/greeting-123.mp3',
    });

    const res = await request(app)
      .post('/api/voicemail/greeting')
      .attach('file', Buffer.from('fake-audio-bytes'), 'My Greeting.wav')
      .expect(200);

    // Ensure storage helper was called correctly
    expect(uploadBufferToStorage).toHaveBeenCalledTimes(1);
    const storageArg = uploadBufferToStorage.mock.calls[0][0];

    // At least make sure we passed *something* buffer-like and an audio contentType
    expect(storageArg).toHaveProperty('buffer');
    expect(storageArg).toHaveProperty('contentType');
    expect(String(storageArg.contentType)).toMatch(/^audio\//);

    // key shape: `voicemail-greetings/${userId}-${Date.now()}-${sanitizedName}`
    expect(storageArg.key).toMatch(/^voicemail-greetings\/123-/);
    expect(storageArg.key).toMatch(/My_Greeting\.wav$/);

    // Ensure prisma.update was called with returned URL
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 123 },
      data: {
        voicemailGreetingUrl: 'https://cdn.example.com/greeting-123.mp3',
      },
      select: {
        voicemailGreetingUrl: true,
      },
    });

    // Response payload
    expect(res.body).toEqual({
      greetingUrl: 'https://cdn.example.com/greeting-123.mp3',
    });
  });

  test('POST /api/voicemail/greeting/text sets greetingText', async () => {
    const app = makeApp();

    prisma.user.update.mockResolvedValueOnce({
      voicemailGreetingText: 'Hey, leave me a message!',
    });

    const res = await request(app)
      .post('/api/voicemail/greeting/text')
      .send({ greetingText: 'Hey, leave me a message!' })
      .set('Content-Type', 'application/json')
      .expect(200);

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 123 },
      data: {
        voicemailGreetingText: 'Hey, leave me a message!',
      },
      select: {
        voicemailGreetingText: true,
      },
    });

    expect(res.body).toEqual({
      greetingText: 'Hey, leave me a message!',
    });
  });

  test('POST /api/voicemail/greeting/text clears greeting when greetingText is empty', async () => {
    const app = makeApp();

    prisma.user.update.mockResolvedValueOnce({
      voicemailGreetingText: null,
    });

    const res = await request(app)
      .post('/api/voicemail/greeting/text')
      .send({ greetingText: '' })
      .set('Content-Type', 'application/json')
      .expect(200);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 123 },
      data: {
        voicemailGreetingText: null,
      },
      select: {
        voicemailGreetingText: true,
      },
    });

    expect(res.body).toEqual({
      greetingText: null,
    });
  });
});
