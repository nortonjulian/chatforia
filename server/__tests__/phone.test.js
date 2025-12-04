import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

// ---- Mock prisma + auth BEFORE importing the router ----
jest.unstable_mockModule('../../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    phoneNumber: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

jest.unstable_mockModule('../../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    // simulate authenticated user
    req.user = { id: 'user-123' };
    next();
  },
}));

// Re-import mocked modules + router
const prismaModule = await import('../../utils/prismaClient.js');
const prisma = prismaModule.default;

const { default: phoneRouter } = await import('./phone.js');

describe('phone routes', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/phone', phoneRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /* -------- POST /:id/reactivate -------- */

  it('reactivates a phone when it belongs to the authenticated user', async () => {
    prisma.phoneNumber.findFirst.mockResolvedValueOnce({
      id: 'phone-1',
      assignedUserId: 'user-123',
      status: 'HOLD',
    });

    prisma.phoneNumber.update.mockResolvedValueOnce({
      id: 'phone-1',
      status: 'ASSIGNED',
    });

    const res = await request(app).post('/api/phone/phone-1/reactivate');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect(prisma.phoneNumber.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'phone-1',
        assignedUserId: 'user-123',
      },
    });

    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 'phone-1' },
      data: {
        lastOutboundAt: expect.any(Date),
        status: 'ASSIGNED',
        holdUntil: null,
        releaseAfter: null,
      },
    });
  });

  it('returns 404 when phone does not exist or is not owned by the user', async () => {
    prisma.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/phone/non-existent-id/reactivate');

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Phone not found' });

    expect(prisma.phoneNumber.update).not.toHaveBeenCalled();
  });

  it('returns 500 when an error occurs during reactivation', async () => {
    const err = new Error('DB failure');
    prisma.phoneNumber.findFirst.mockRejectedValueOnce(err);

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const res = await request(app).post('/api/phone/phone-err/reactivate');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  /* -------- GET / (list user phone numbers) -------- */

  it('lists phone numbers for the authenticated user', async () => {
    const mockedNumbers = [
      {
        id: 'phone-1',
        e164: '+15551234567',
        status: 'ASSIGNED',
        releaseAfter: null,
      },
      {
        id: 'phone-2',
        e164: '+15559876543',
        status: 'HOLD',
        releaseAfter: new Date('2100-01-01T00:00:00.000Z'),
      },
    ];

    prisma.phoneNumber.findMany.mockResolvedValueOnce(mockedNumbers);

    const res = await request(app).get('/api/phone');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ numbers: mockedNumbers });

    expect(prisma.phoneNumber.findMany).toHaveBeenCalledWith({
      where: { assignedUserId: 'user-123' },
      select: {
        id: true,
        e164: true,
        status: true,
        releaseAfter: true,
      },
    });
  });

  it('returns 500 when an error occurs while listing numbers', async () => {
    const err = new Error('DB failure');
    prisma.phoneNumber.findMany.mockRejectedValueOnce(err);

    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const res = await request(app).get('/api/phone');

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to load numbers' });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
