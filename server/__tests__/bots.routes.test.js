/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---------- Prisma mock via @prisma/client ----------

const mockPrisma = {
  user: {
    create: jest.fn(),
  },
  bot: {
    create: jest.fn(),
  },
  botInstall: {
    create: jest.fn(),
    update: jest.fn(),
    findUnique: jest.fn(),
  },
};

await jest.unstable_mockModule('@prisma/client', () => {
  const PrismaClient = jest.fn(() => mockPrisma);
  return {
    default: { PrismaClient },
    PrismaClient,
  };
});

// ---------- Other dependency mocks ----------

// botSign.verifySignature
const verifySignatureMock = jest.fn();
await jest.unstable_mockModule('../utils/botSign.js', () => ({
  verifySignature: verifySignatureMock,
}));

// messageService.createMessageService
const createMessageServiceMock = jest.fn();
await jest.unstable_mockModule('../services/messageService.js', () => ({
  createMessageService: createMessageServiceMock,
}));

// requireAuth middleware: always attach an ADMIN user
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 123, role: 'ADMIN' };
    next();
  },
}));

// Import router AFTER mocks
const botsModule = await import('../routes/bots.js');
const botsRouter = botsModule.default;

// helper to build an app with optional io object
function makeApp(io = null) {
  const app = express();
  app.use(express.json());
  if (io) app.set('io', io);
  app.use('/bots', botsRouter);
  return app;
}

describe('bots routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FORIA_BOT_USER_ID;
    process.env.BOT_TOLERANCE_SECONDS = '300';
  });

  describe('POST /bots', () => {
    test('returns 400 when required fields are missing', async () => {
      const app = makeApp();
      const res = await request(app).post('/bots').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'name, url, secret required' });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.bot.create).not.toHaveBeenCalled();
    });

    test('creates service user and bot when body is valid', async () => {
      const app = makeApp();

      mockPrisma.user.create.mockResolvedValue({ id: 999 });
      const botRecord = {
        id: 1,
        name: 'MyBot',
        url: 'https://bot.example.com',
        secret: 'shh',
        ownerId: 123,
        serviceUserId: 999,
      };
      mockPrisma.bot.create.mockResolvedValue(botRecord);

      const body = {
        name: 'MyBot',
        url: 'https://bot.example.com',
        secret: 'shh',
      };

      const res = await request(app).post('/bots').send(body);

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(botRecord);

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          username: 'MyBot',
          role: 'BOT',
          allowExplicitContent: true,
        },
        select: { id: true },
      });

      expect(mockPrisma.bot.create).toHaveBeenCalledWith({
        data: {
          ownerId: 123, // from req.user.id
          name: 'MyBot',
          url: 'https://bot.example.com',
          secret: 'shh',
          serviceUserId: 999,
        },
      });
    });
  });

  describe('POST /bots/:id/install', () => {
    test('returns 400 when botId or chatRoomId missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/bots/1/install')
        .send({}); // missing chatRoomId

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'botId & chatRoomId required' });
      expect(mockPrisma.botInstall.create).not.toHaveBeenCalled();
    });

    test('creates bot install with default contentScope COMMANDS', async () => {
      const app = makeApp();

      const installRecord = {
        id: 10,
        botId: 1,
        chatRoomId: 777,
        contentScope: 'COMMANDS',
        bot: { id: 1, name: 'MyBot' },
      };
      mockPrisma.botInstall.create.mockResolvedValue(installRecord);

      const res = await request(app)
        .post('/bots/1/install')
        .send({ chatRoomId: 777 });

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(installRecord);

      expect(mockPrisma.botInstall.create).toHaveBeenCalledWith({
        data: { botId: 1, chatRoomId: 777, contentScope: 'COMMANDS' },
        include: { bot: true },
      });
    });
  });

  describe('PATCH /bots/installs/:installId', () => {
    test('updates isEnabled and contentScope when provided', async () => {
      const app = makeApp();

      const updated = {
        id: 10,
        isEnabled: true,
        contentScope: 'ALL',
      };
      mockPrisma.botInstall.update.mockResolvedValue(updated);

      const res = await request(app)
        .patch('/bots/installs/10')
        .send({ isEnabled: true, contentScope: 'ALL' });

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(updated);

      expect(mockPrisma.botInstall.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: {
          isEnabled: true,
          contentScope: 'ALL',
        },
      });
    });
  });

  describe('POST /bots/:installId/reply', () => {
    test('returns 404 when install is not found', async () => {
      const app = makeApp();
      mockPrisma.botInstall.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/bots/123/reply')
        .send({ content: 'hi' });

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'install not found' });
    });

    test('returns 403 when install is disabled', async () => {
      const app = makeApp();
      mockPrisma.botInstall.findUnique.mockResolvedValue({
        id: 1,
        isEnabled: false,
        bot: { secret: 'shh', serviceUserId: 42 },
        chatRoomId: 555,
      });

      const res = await request(app)
        .post('/bots/1/reply')
        .send({ content: 'hi' });

      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual({ error: 'install disabled' });
    });

    test('returns 401 when signature verification fails', async () => {
      const app = makeApp();
      mockPrisma.botInstall.findUnique.mockResolvedValue({
        id: 1,
        isEnabled: true,
        bot: { secret: 'shh', serviceUserId: 42 },
        chatRoomId: 555,
      });

      verifySignatureMock.mockReturnValue(false);

      const res = await request(app)
        .post('/bots/1/reply')
        .set('X-Chatforia-Timestamp', '123456789')
        .set('X-Chatforia-Signature', 'sha256=deadbeef')
        .send({ content: 'hi' });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'invalid signature' });

      expect(verifySignatureMock).toHaveBeenCalled();
    });

    test('happy path: creates message and emits to room', async () => {
      const io = {
        to: jest.fn().mockReturnThis(),
        emit: jest.fn(),
      };
      const app = makeApp(io);

      mockPrisma.botInstall.findUnique.mockResolvedValue({
        id: 1,
        isEnabled: true,
        bot: { secret: 'shh', serviceUserId: 42 },
        chatRoomId: 555,
      });

      verifySignatureMock.mockReturnValue(true);

      const message = {
        id: 'msg1',
        senderId: 42,
        chatRoomId: 555,
        content: 'hello from bot',
      };
      createMessageServiceMock.mockResolvedValue(message);

      const res = await request(app)
        .post('/bots/1/reply')
        .set('X-Chatforia-Timestamp', '123456789')
        .set('X-Chatforia-Signature', 'sha256=deadbeef')
        .send({ content: 'hello from bot', attachments: [] });

      expect(res.statusCode).toBe(201);
      expect(res.body).toEqual(message);

      expect(createMessageServiceMock).toHaveBeenCalledWith({
        senderId: 42,
        chatRoomId: 555,
        content: 'hello from bot',
        attachments: [],
      });

      // broadcast to room via io
      expect(io.to).toHaveBeenCalledWith('555'); // String(chatRoomId)
      expect(io.emit).toHaveBeenCalledWith('receive_message', message);
    });

    test('returns 400 when neither content nor attachments provided', async () => {
      const app = makeApp();

      mockPrisma.botInstall.findUnique.mockResolvedValue({
        id: 1,
        isEnabled: true,
        bot: { secret: 'shh', serviceUserId: 42 },
        chatRoomId: 555,
      });

      verifySignatureMock.mockReturnValue(true);

      const res = await request(app)
        .post('/bots/1/reply')
        .set('X-Chatforia-Timestamp', '123456789')
        .set('X-Chatforia-Signature', 'sha256=deadbeef')
        .send({}); // no content or attachments

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'content or attachments required' });
      expect(createMessageServiceMock).not.toHaveBeenCalled();
    });
  });
});
