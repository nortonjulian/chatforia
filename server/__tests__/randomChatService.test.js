/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// ---- mock PrismaClient ----
const mockPrisma = {
  randomChatRoom: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
};

// ESM-style Jest mocking
await jest.unstable_mockModule('@prisma/client', () => {
  // routes/randomChats.js does: `import pkg from '@prisma/client'; const { PrismaClient } = pkg;`
  const PrismaClient = jest.fn(() => mockPrisma);
  return {
    default: { PrismaClient },
    PrismaClient,
  };
});

// ---- mock requireAuth middleware ----
await jest.unstable_mockModule('../middleware/auth.js', () => {
  return {
    requireAuth: (req, _res, next) => {
      // fake authenticated user
      req.user = { id: 1, username: 'tester' };
      next();
    },
  };
});

// after mocks, import the router module
const randomChatsModule = await import('../routes/randomChats.js');
const randomChatsRouter = randomChatsModule.default;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/random-chats', randomChatsRouter);
  return app;
}

describe('randomChats REST routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  test('POST /random-chats 400 when messages is not an array', async () => {
    const res = await request(app)
      .post('/random-chats')
      .send({ messages: 'not-array', participants: [1, 2] });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'messages must be an array' });
    expect(mockPrisma.randomChatRoom.create).not.toHaveBeenCalled();
  });

  test('POST /random-chats 400 when participants invalid', async () => {
    const res = await request(app)
      .post('/random-chats')
      .send({ messages: [], participants: [1] });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'participants must be an array of two user IDs',
    });
    expect(mockPrisma.randomChatRoom.create).not.toHaveBeenCalled();
  });

  test('POST /random-chats 201 on success', async () => {
    const savedChat = {
      id: 10,
      participants: [{ id: 1 }, { id: 2 }],
      messages: [
        {
          id: 100,
          content: 'hello',
          senderId: 1,
          sender: { id: 1, username: 'tester' },
        },
      ],
    };

    mockPrisma.randomChatRoom.create.mockResolvedValue(savedChat);

    const payload = {
      participants: [1, 2],
      messages: [
        {
          senderId: 1,
          content: 'hello',
        },
      ],
    };

    const res = await request(app).post('/random-chats').send(payload);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(savedChat);

    expect(mockPrisma.randomChatRoom.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.randomChatRoom.create).toHaveBeenCalledWith({
      data: {
        participants: { connect: [{ id: 1 }, { id: 2 }] },
        messages: {
          create: [
            {
              content: 'hello',
              sender: { connect: { id: 1 } },
            },
          ],
        },
      },
      include: {
        participants: true,
        messages: { include: { sender: true } },
      },
    });
  });

  test('POST /random-chats 500 on Prisma error', async () => {
    mockPrisma.randomChatRoom.create.mockRejectedValue(
      new Error('DB error')
    );

    const res = await request(app)
      .post('/random-chats')
      .send({ participants: [1, 2], messages: [] });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to save chat' });
  });

  test('GET /random-chats returns chats for current user', async () => {
    const chats = [
      {
        id: 1,
        participants: [{ id: 1 }, { id: 2 }],
        messages: [],
      },
    ];
    mockPrisma.randomChatRoom.findMany.mockResolvedValue(chats);

    const res = await request(app).get('/random-chats');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(chats);

    expect(mockPrisma.randomChatRoom.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.randomChatRoom.findMany).toHaveBeenCalledWith({
      where: { participants: { some: { id: 1 } } },
      include: { participants: true, messages: { include: { sender: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  test('GET /random-chats 500 on Prisma error', async () => {
    mockPrisma.randomChatRoom.findMany.mockRejectedValue(
      new Error('DB error')
    );

    const res = await request(app).get('/random-chats');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch chats' });
  });

  test('GET /random-chats/id/:id 400 for invalid id', async () => {
    const res = await request(app).get('/random-chats/id/not-a-number');
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid chat id' });
    expect(mockPrisma.randomChatRoom.findUnique).not.toHaveBeenCalled();
  });

  test('GET /random-chats/id/:id 403 if user not a participant', async () => {
    mockPrisma.randomChatRoom.findUnique.mockResolvedValue({
      id: 5,
      participants: [{ id: 2 }], // current user is 1
      messages: [],
    });

    const res = await request(app).get('/random-chats/id/5');

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: 'You do not have access to this chat.',
    });
  });

  test('GET /random-chats/id/:id 200 when user is a participant', async () => {
    const chat = {
      id: 5,
      participants: [{ id: 1 }, { id: 2 }],
      messages: [
        {
          id: 10,
          content: 'hi',
          sender: { id: 1, username: 'tester' },
        },
      ],
    };
    mockPrisma.randomChatRoom.findUnique.mockResolvedValue(chat);

    const res = await request(app).get('/random-chats/id/5');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(chat);

    expect(mockPrisma.randomChatRoom.findUnique).toHaveBeenCalledWith({
      where: { id: 5 },
      include: {
        participants: true,
        messages: {
          include: { sender: { select: { id: true, username: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  });

  test('GET /random-chats/id/:id 500 on Prisma error', async () => {
    mockPrisma.randomChatRoom.findUnique.mockRejectedValue(
      new Error('DB error')
    );

    const res = await request(app).get('/random-chats/id/123');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to load chat' });
  });
});
