import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const mockPrisma = {
  user: { findUnique: jest.fn(), findFirst: jest.fn() },
  supportTicket: {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  supportAutomationEvent: {
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  verificationToken: {
    updateMany: jest.fn(),
    create: jest.fn(),
  },
};

let optionalUser = null;

const mockVerifyTokenOptional = jest.fn((req, _res, next) => {
  req.user = optionalUser;
  next();
});
const mockRequireAuth = jest.fn((req, _res, next) => {
  req.user = { id: 999, role: 'ADMIN' };
  next();
});
const mockRequireAdmin = jest.fn((_req, _res, next) => next());
const mockRunSupportAutomation = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: mockPrisma,
}));
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  verifyTokenOptional: mockVerifyTokenOptional,
  requireAuth: mockRequireAuth,
  requireAdmin: mockRequireAdmin,
}));
await jest.unstable_mockModule('../services/supportAutomationService.js', () => ({
  __esModule: true,
  runSupportAutomation: mockRunSupportAutomation,
}));
await jest.unstable_mockModule('../utils/tokens.js', () => ({
  __esModule: true,
  newRawToken: jest.fn(() => 'raw'),
  hashToken: jest.fn(async () => 'hash'),
}));
await jest.unstable_mockModule('../utils/sendMail.js', () => ({
  __esModule: true,
  sendMail: jest.fn(async () => {}),
}));

const supportRouter = (await import('../routes/support.js')).default;
const adminSupportRouter = (await import('../routes/adminSupport.js')).default;

function makeSupportApp() {
  const app = express();
  app.use(express.json());
  app.use('/support', supportRouter);
  app.use((err, _req, res, _next) =>
    res.status(500).json({ error: err?.message || 'error' })
  );
  return app;
}

function makeAdminApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin/support', adminSupportRouter);
  app.use((err, _req, res, _next) =>
    res.status(500).json({ error: err?.message || 'error' })
  );
  return app;
}

const automationResult = {
  diagnosis: {
    resolved: false,
    severity: 'normal',
    category: 'billing_or_premium',
    userMessage: 'Queued',
    nextAction: 'wait',
  },
  autoAction: {
    status: 'queued',
    action: 'queue_for_support_review',
  },
};

describe('support plan entitlements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    optionalUser = null;
    mockRunSupportAutomation.mockResolvedValue(automationResult);
    mockPrisma.supportTicket.create.mockImplementation(async ({ data }) => ({
      id: 77,
      ...data,
    }));
    mockPrisma.supportTicket.update.mockResolvedValue({ id: 77, status: 'new' });
  });

  test.each([
    ['FREE', 'STANDARD', 0],
    ['PLUS', 'EMAIL', 1],
    ['PREMIUM', 'PRIORITY', 2],
  ])('persists %s support entitlement as %s priority %i', async (plan, expectedLevel, expectedPriority) => {
    optionalUser = { id: 123 };
    mockPrisma.user.findUnique.mockResolvedValue({ plan });

    const res = await request(makeSupportApp())
      .post('/support/tickets')
      .send({ name: 'User', email: 'user@example.com', message: 'Need help' })
      .expect(201);

    expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supportLevel: expectedLevel,
        supportPriority: expectedPriority,
      }),
    });
    expect(res.body.supportLevel).toBe(expectedLevel);
  });

  test('anonymous tickets remain STANDARD', async () => {
    const res = await request(makeSupportApp())
      .post('/support/tickets')
      .send({ name: 'Guest', email: 'guest@example.com', message: 'Need help' })
      .expect(201);

    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supportLevel: 'STANDARD',
        supportPriority: 0,
      }),
    });
    expect(res.body.supportLevel).toBe('STANDARD');
  });

  test.each([
    { name: '   ', email: 'user@example.com', message: 'Help' },
    { name: 'User', email: '   ', message: 'Help' },
    { name: 'User', email: 'user@example.com', message: '   ' },
    { name: 123, email: 'user@example.com', message: 'Help' },
    { name: 'User', email: {}, message: 'Help' },
    { name: 'User', email: 'user@example.com', message: [] },
  ])('rejects invalid support fields: %j', async (payload) => {
    const res = await request(makeSupportApp())
      .post('/support/tickets')
      .send(payload)
      .expect(400);

    expect(res.body).toEqual({
      error: 'Missing required fields',
    });

    expect(mockPrisma.supportTicket.create).not.toHaveBeenCalled();
    expect(mockRunSupportAutomation).not.toHaveBeenCalled();
  });

  test.each([
    'not-an-email',
    'user@',
    '@example.com',
    'user example@example.com',
  ])('rejects malformed support email: %s', async (email) => {
    const res = await request(makeSupportApp())
      .post('/support/tickets')
      .send({
        name: 'Customer',
        email,
        message: 'Need help',
      })
      .expect(400);

    expect(res.body).toEqual({
      error: 'Invalid email address',
    });

    expect(mockPrisma.supportTicket.create).not.toHaveBeenCalled();
    expect(mockRunSupportAutomation).not.toHaveBeenCalled();
  });

  test('saved ticket returns 201 when automation fails', async () => {
    const errorSpy = jest.spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      mockRunSupportAutomation.mockRejectedValueOnce(
        new Error('Automation unavailable')
      );

      const res = await request(makeSupportApp())
        .post('/support/tickets')
        .send({
          name: 'Customer',
          email: 'customer@example.com',
          message: 'I need help with my account.',
        })
        .expect(201);

      expect(mockPrisma.supportTicket.create).toHaveBeenCalledTimes(1);

      expect(mockPrisma.supportTicket.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'new',
          supportLevel: 'STANDARD',
        }),
      });

      expect(res.body).toEqual(
        expect.objectContaining({
          ok: true,
          ticketId: 77,
          status: 'queued',
          resolved: false,
        })
      );

      expect(mockPrisma.supportTicket.update).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('database failure does not return false success', async () => {
    const errorSpy = jest.spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      mockPrisma.supportTicket.create.mockRejectedValueOnce(
        new Error('Database unavailable')
      );

      const res = await request(makeSupportApp())
        .post('/support/tickets')
        .send({
          name: 'Customer',
          email: 'customer@example.com',
          message: 'I need help.',
        })
        .expect(500);

      expect(res.body.ok).not.toBe(true);
      expect(mockRunSupportAutomation).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test.each([
    'new',
    'in_progress',
    'closed',
    'escalated',
    'auto_resolved',
    'resolved',
  ])('admin accepts supported ticket status: %s', async (status) => {
    mockPrisma.supportTicket.update.mockResolvedValueOnce({
      id: 77,
      status,
    });

    const res = await request(makeAdminApp())
      .patch('/admin/support/tickets/77')
      .send({ status })
      .expect(200);

    expect(res.body.ok).toBe(true);

    expect(mockPrisma.supportTicket.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { status },
    });
  });

  test.each([
    'unknown',
    'pending',
    '',
    123,
  ])('admin rejects unsupported ticket status: %s', async (status) => {
    await request(makeAdminApp())
      .patch('/admin/support/tickets/77')
      .send({ status })
      .expect(400);

    expect(mockPrisma.supportTicket.update).not.toHaveBeenCalled();
  });

  test.each([
    '0',
    '-1',
    '1.5',
    'abc',
  ])('admin rejects invalid ticket ID: %s', async (id) => {
    await request(makeAdminApp())
      .patch(`/admin/support/tickets/${id}`)
      .send({ status: 'resolved' })
      .expect(400);

    expect(mockPrisma.supportTicket.update).not.toHaveBeenCalled();
  });

  test('admin rejects unsupported ticket status filter', async () => {
    await request(makeAdminApp())
      .get('/admin/support/tickets')
      .query({ status: 'unknown' })
      .expect(400);

    expect(mockPrisma.supportTicket.findMany).not.toHaveBeenCalled();
  });

  test('admin ticket queue orders priority first, then newest', async () => {
    mockPrisma.supportTicket.findMany.mockResolvedValue([]);

    await request(makeAdminApp())
      .get('/admin/support/tickets')
      .expect(200);

    expect(mockPrisma.supportTicket.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: [
        { supportPriority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    });
  });
});
