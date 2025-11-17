import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// ---- Mocks ----
const mockPrisma = {
  contact: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
  },
};

// Fake PrismaClient so "new PrismaClient()" returns our mockPrisma
class FakePrismaClient {
  constructor() {
    return mockPrisma;
  }
}

const mockToE164 = jest.fn();
const mockRequireAuth = jest.fn((req, _res, next) => {
  req.user = { id: 1 };     // ownerId = 1 everywhere
  req.region = 'US';        // default region for phone parsing
  next();
});

// ---- Mock modules BEFORE importing the router ----
await jest.unstable_mockModule('@prisma/client', () => ({
  __esModule: true,
  default: { PrismaClient: FakePrismaClient },
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

await jest.unstable_mockModule('../utils/phone.js', () => ({
  __esModule: true,
  toE164: mockToE164,
}));

// Import router under test
const contactsRouter = (await import('../routes/contacts.js')).default;

// Build Express app
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/contacts', contactsRouter);

  // Simple error handler (Boom-aware, but contacts uses manual JSON errors)
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

describe('contacts routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('GET /contacts', () => {
    it('returns paginated contacts with search filter and nextCursor', async () => {
      mockPrisma.contact.findMany.mockResolvedValue([
        {
          id: 10,
          alias: 'Alice',
          favorite: true,
          externalPhone: '+15550001111',
          externalName: 'Alice External',
          createdAt: '2025-01-01T00:00:00.000Z',
          userId: 2,
          user: { id: 2, username: 'alice', avatarUrl: 'avatar.png' },
        },
        {
          id: 11,
          alias: 'Bob',
          favorite: false,
          externalPhone: '+15550002222',
          externalName: 'Bobby',
          createdAt: '2025-01-02T00:00:00.000Z',
          userId: 3,
          user: { id: 3, username: 'bob', avatarUrl: null },
        },
      ]);

      const res = await request(app)
        .get('/contacts')
        .query({ q: 'al', limit: 2, cursor: 5 })
        .expect(200);

      // prisma.contact.findMany called with ownerId, search + pagination
      expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(1);
      const args = mockPrisma.contact.findMany.mock.calls[0][0];

      expect(args.where.ownerId).toBe(1);
      expect(args.where.OR).toBeDefined();
      expect(args.orderBy).toEqual({ id: 'asc' });
      expect(args.take).toBe(2);
      expect(args.cursor).toEqual({ id: 5 });
      expect(args.skip).toBe(1);

      // Response shape
      expect(res.body.count).toBe(2);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.nextCursor).toBe(11);
    });
  });

  describe('POST /contacts', () => {
    it('returns 400 when neither userId nor externalPhone is provided', async () => {
      const res = await request(app)
        .post('/contacts')
        .send({ alias: 'Test' })
        .expect(400);

      expect(res.body).toEqual({
        error: 'Provide userId or externalPhone',
      });
      expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
    });

    it('upserts a contact by userId', async () => {
      const contact = {
        id: 100,
        alias: 'Bestie',
        favorite: true,
        externalPhone: null,
        externalName: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        user: { id: 2, username: 'friend', avatarUrl: null },
      };

      mockPrisma.contact.upsert.mockResolvedValue(contact);

      const res = await request(app)
        .post('/contacts')
        .send({
          userId: 2,
          alias: 'Bestie',
          favorite: true,
        })
        .expect(201);

      expect(mockPrisma.contact.upsert).toHaveBeenCalledWith({
        where: { ownerId_userId: { ownerId: 1, userId: 2 } },
        update: {
          alias: 'Bestie',
          favorite: true,
        },
        create: {
          ownerId: 1,
          userId: 2,
          alias: 'Bestie',
          favorite: true,
        },
        select: {
          id: true,
          alias: true,
          favorite: true,
          externalPhone: true,
          externalName: true,
          createdAt: true,
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
      });

      expect(res.body).toEqual(contact);
    });

    it('returns 400 for invalid externalPhone', async () => {
      mockToE164.mockReturnValueOnce(null);

      const res = await request(app)
        .post('/contacts')
        .send({
          externalPhone: 'not-a-phone',
          alias: 'Bad',
        })
        .expect(400);

      expect(res.body).toEqual({
        error: 'Invalid phone number.',
      });
      expect(mockPrisma.contact.upsert).not.toHaveBeenCalled();
    });

    it('upserts a contact by externalPhone (normalized E.164)', async () => {
      mockToE164.mockReturnValueOnce('+15551234567'); // normalized

      const contact = {
        id: 101,
        alias: 'Mom',
        favorite: true,
        externalPhone: '+15551234567',
        externalName: 'Mommy',
        createdAt: '2025-01-02T00:00:00.000Z',
        user: null,
      };

      mockPrisma.contact.upsert.mockResolvedValue(contact);

      const res = await request(app)
        .post('/contacts')
        .send({
          externalPhone: '555-123-4567',
          alias: 'Mom',
          externalName: 'Mommy',
          favorite: true,
        })
        .expect(201);

      expect(mockToE164).toHaveBeenCalledWith('555-123-4567', 'US');

      expect(mockPrisma.contact.upsert).toHaveBeenCalledWith({
        where: {
          ownerId_externalPhone: {
            ownerId: 1,
            externalPhone: '+15551234567',
          },
        },
        update: {
          alias: 'Mom',
          externalName: 'Mommy',
          favorite: true,
        },
        create: {
          ownerId: 1,
          externalPhone: '+15551234567',
          externalName: 'Mommy',
          alias: 'Mom',
          favorite: true,
        },
        select: {
          id: true,
          alias: true,
          favorite: true,
          externalPhone: true,
          externalName: true,
          createdAt: true,
          user: { select: { id: true, username: true, avatarUrl: true } },
        },
      });

      expect(res.body).toEqual(contact);
    });
  });

  describe('PATCH /contacts', () => {
    it('returns 400 for invalid externalPhone when updating by phone', async () => {
      mockToE164.mockReturnValueOnce(null);

      const res = await request(app)
        .patch('/contacts')
        .send({
          externalPhone: '123',
          alias: 'X',
        })
        .expect(400);

      expect(res.body).toEqual({
        error: 'Invalid phone number.',
      });
      expect(mockPrisma.contact.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /contacts/:id', () => {
    it('returns 404 when contact is not owned by user or missing', async () => {
      mockPrisma.contact.findUnique.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete('/contacts/777')
        .expect(404);

      expect(res.body).toEqual({ error: 'Contact not found' });
      expect(mockPrisma.contact.delete).not.toHaveBeenCalled();
    });

    it('deletes contact when owned by user', async () => {
      mockPrisma.contact.findUnique.mockResolvedValueOnce({ ownerId: 1 });

      const res = await request(app)
        .delete('/contacts/777')
        .expect(200);

      expect(mockPrisma.contact.findUnique).toHaveBeenCalledWith({
        where: { id: 777 },
        select: { ownerId: true },
      });
      expect(mockPrisma.contact.delete).toHaveBeenCalledWith({
        where: { id: 777 },
      });
      expect(res.body).toEqual({ success: true });
    });
  });

  describe('GET /contacts/_debug_me', () => {
    it('returns user id and region from requireAuth', async () => {
      const res = await request(app)
        .get('/contacts/_debug_me')
        .expect(200);

      expect(res.body).toEqual({
        id: 1,
        region: 'US',
        typeof: 'number',
      });
    });
  });
});
