import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

const prisma = {
  portRequest: {
    findFirst: jest.fn(),
  },
  phoneNumber: {
    upsert: jest.fn(),
  },
};

const updatePortStatus = jest.fn();

await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prisma,
}));

await jest.unstable_mockModule('../services/portingService.js', () => ({
  __esModule: true,
  updatePortStatus,
}));

const { default: router } = await import('../routes/twilioPortingWebhook.js');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use('/twilio/porting', router);

  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

describe('twilioPortingWebhook routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when externalPortId is missing', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/twilio/porting')
      .send({ status: 'completed' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing externalPortId' });
    expect(prisma.portRequest.findFirst).not.toHaveBeenCalled();
    expect(updatePortStatus).not.toHaveBeenCalled();
    expect(prisma.phoneNumber.upsert).not.toHaveBeenCalled();
  });

  it('returns ok when no matching portRequest is found', async () => {
    const app = createApp();

    prisma.portRequest.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/twilio/porting')
      .send({
        portInSid: 'PR_123',
        status: 'pending',
      });

    expect(prisma.portRequest.findFirst).toHaveBeenCalledWith({
      where: { externalPortId: 'PR_123' },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(updatePortStatus).not.toHaveBeenCalled();
    expect(prisma.phoneNumber.upsert).not.toHaveBeenCalled();
  });

  it('maps a failed status, updates port status, and does not upsert phone number', async () => {
    const app = createApp();

    const mockPortRequest = {
      id: 'port_req_1',
      userId: 'user_1',
      phoneNumber: '+1 555 123 0000',
    };

    const scheduledDate = '2030-01-01T10:00:00.000Z';

    prisma.portRequest.findFirst.mockResolvedValueOnce(mockPortRequest);

    updatePortStatus.mockResolvedValueOnce({
      ...mockPortRequest,
      status: 'FAILED',
      statusReason: 'Carrier rejected',
    });

    const res = await request(app)
      .post('/twilio/porting')
      .send({
        portOrderSid: 'ORD_123',
        status: 'failed',
        statusReason: 'Carrier rejected',
        scheduledDate,
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(prisma.portRequest.findFirst).toHaveBeenCalledWith({
      where: { externalPortId: 'ORD_123' },
    });

    expect(updatePortStatus).toHaveBeenCalledTimes(1);

    const [calledId, updateArg] = updatePortStatus.mock.calls[0];

    expect(calledId).toBe('port_req_1');
    expect(updateArg.status).toBe('FAILED');
    expect(updateArg.statusReason).toBe('Carrier rejected');
    expect(updateArg.scheduledAt).toEqual(new Date(scheduledDate));
    expect(updateArg.completedAt).toBeUndefined();

    expect(prisma.phoneNumber.upsert).not.toHaveBeenCalled();
  });

  it('maps completed status, updates port status, and upserts phone number', async () => {
    const app = createApp();

    const mockPortRequest = {
      id: 'port_req_2',
      userId: 'user_2',
      phoneNumber: '+1 555 999 0000',
    };

    prisma.portRequest.findFirst.mockResolvedValueOnce(mockPortRequest);

    updatePortStatus.mockResolvedValueOnce({
      ...mockPortRequest,
      status: 'COMPLETED',
    });

    const res = await request(app)
      .post('/twilio/porting')
      .send({
        portInSid: 'PORT_999',
        status: 'completed',
        statusReason: 'Completed successfully',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(prisma.portRequest.findFirst).toHaveBeenCalledWith({
      where: { externalPortId: 'PORT_999' },
    });

    expect(updatePortStatus).toHaveBeenCalledTimes(1);

    const [calledId, updateArg] = updatePortStatus.mock.calls[0];

    expect(calledId).toBe('port_req_2');
    expect(updateArg.status).toBe('COMPLETED');
    expect(updateArg.statusReason).toBe('Completed successfully');
    expect(updateArg.completedAt).toBeInstanceOf(Date);
    expect(updateArg.scheduledAt).toBeUndefined();

    expect(prisma.phoneNumber.upsert).toHaveBeenCalledWith({
      where: { userId: 'user_2' },
      create: {
        userId: 'user_2',
        phoneNumber: '+1 555 999 0000',
        isPrimary: true,
        source: 'PORTED',
      },
      update: {
        phoneNumber: '+1 555 999 0000',
        isPrimary: true,
        source: 'PORTED',
      },
    });
  });

  it('maps pending/submitted statuses to SUBMITTED', async () => {
    const app = createApp();

    const mockPortRequest = {
      id: 'port_req_3',
      userId: 'user_3',
      phoneNumber: '+1 555 222 3333',
    };

    prisma.portRequest.findFirst.mockResolvedValueOnce(mockPortRequest);

    updatePortStatus.mockResolvedValueOnce({
      ...mockPortRequest,
      status: 'SUBMITTED',
    });

    const res = await request(app)
      .post('/twilio/porting')
      .send({
        portOrderSid: 'ORD_222',
        status: 'pending',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const [calledId, updateArg] = updatePortStatus.mock.calls[0];

    expect(calledId).toBe('port_req_3');
    expect(updateArg.status).toBe('SUBMITTED');
    expect(updateArg.statusReason).toBeNull();
  });
});