import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Shared mocks ---
const mockPrisma = {
  chatRoom: {
    update: jest.fn(),
  },
};

const mockRequireAuth = jest.fn((req, _res, next) => {
  // simulate authenticated user
  req.user = { id: 123 };
  next();
});

// requireRoomAdmin('id') returns a middleware
const mockRequireRoomAdminFactory = jest.fn((paramName) =>
  jest.fn((req, _res, next) => {
    // Tag the request so we can assert usage if needed
    req._roomAdminCheckedFor = paramName;
    next();
  }),
);

// asyncHandler wrapper that behaves like a normal wrapper
const mockAsyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ----- Set up module mocks BEFORE importing router -----
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));

await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: mockRequireAuth,
}));

await jest.unstable_mockModule('../middleware/roomAuth.js', () => ({
  __esModule: true,
  requireRoomAdmin: mockRequireRoomAdminFactory,
}));

await jest.unstable_mockModule('../utils/asyncHandler.js', () => ({
  __esModule: true,
  asyncHandler: mockAsyncHandler,
}));

// Now import the router under test
const featuresRouter = (await import('../routes/features.js')).default;

// Build an Express app using the router
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/features', featuresRouter);

  // Simple Boom-aware error handler
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

describe('features routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('GET /features', () => {
    it('returns status true when STATUS_ENABLED is "true"', async () => {
      process.env.STATUS_ENABLED = 'true';

      const res = await request(app)
        .get('/features')
        .expect(200);

      expect(res.body).toEqual({ status: true });
    });

    it('returns status false when STATUS_ENABLED is not "true"', async () => {
      process.env.STATUS_ENABLED = 'false';

      const res = await request(app)
        .get('/features')
        .expect(200);

      expect(res.body).toEqual({ status: false });
    });
  });

  describe('PATCH /features/rooms/:id/auto-translate', () => {
    it('updates autoTranslateMode when id and mode are valid', async () => {
      const updatedRoom = {
        id: 42,
        name: 'Test Room',
        autoTranslateMode: 'tagged',
      };

      mockPrisma.chatRoom.update.mockResolvedValue(updatedRoom);

      const res = await request(app)
        .patch('/features/rooms/42/auto-translate')
        .send({ mode: 'tagged' })
        .expect(200);

      // prisma.chatRoom.update called with correct args
      expect(mockPrisma.chatRoom.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { autoTranslateMode: 'tagged' },
        select: { id: true, name: true, autoTranslateMode: true },
      });

      expect(res.body).toEqual(updatedRoom);
    });

    it('returns 400 when room id is invalid', async () => {
      const res = await request(app)
        .patch('/features/rooms/not-a-number/auto-translate')
        .send({ mode: 'off' })
        .expect(400);

      expect(res.body).toEqual({ message: 'Invalid room id' });
      expect(mockPrisma.chatRoom.update).not.toHaveBeenCalled();
    });

    it('returns 400 when mode is invalid', async () => {
      const res = await request(app)
        .patch('/features/rooms/10/auto-translate')
        .send({ mode: 'weird-mode' })
        .expect(400);

      expect(res.body).toEqual({ message: 'Invalid mode' });
      expect(mockPrisma.chatRoom.update).not.toHaveBeenCalled();
    });
  });
});
