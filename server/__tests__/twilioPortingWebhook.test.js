import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const prisma = {
  portRequest: { findFirst: jest.fn() },
  phoneNumber: { upsert: jest.fn() },
};
const updatePortStatus = jest.fn();
await jest.unstable_mockModule('../utils/prismaClient.js', () => ({ default: prisma }));
await jest.unstable_mockModule('../services/portingService.js', () => ({ updatePortStatus }));
const { default: router } = await import('../routes/twilioPortingWebhook.js');

const app = express();
app.use(express.json());
app.use('/webhooks/twilio/porting', router);
app.use((_error, _req, res, _next) => res.sendStatus(500));

const post = (body) => request(app).post('/webhooks/twilio/porting').send(body);
const portRequest = {
  id: 'port_req_synthetic',
  userId: 7,
  phoneNumber: '+15550001111',
  status: 'NONE',
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.portRequest.findFirst.mockResolvedValue(portRequest);
  updatePortStatus.mockResolvedValue({ ...portRequest, status: 'PORT_IN_PENDING' });
});

describe('Twilio porting callback payload and model', () => {
  test('requires a request SID before reading state', async () => {
    await post({ status: 'pending' }).expect(400);
    expect(prisma.portRequest.findFirst).not.toHaveBeenCalled();
    expect(updatePortStatus).not.toHaveBeenCalled();
  });

  test.each(['waiting_for_signature', 'submitted', 'pending', 'in_progress'])(
    'maps documented request-level %s to the Prisma pending enum', async (status) => {
      await post({
        port_in_request_sid: 'PI-synthetic',
        port_in_phone_number_sid: null,
        phone_number: null,
        status,
        last_date_updated: '2030-01-01 00:00:00.000',
      }).expect(200, { ok: true });
      expect(prisma.portRequest.findFirst).toHaveBeenCalledWith({
        where: { externalPortId: 'PI-synthetic' },
      });
      expect(updatePortStatus).toHaveBeenCalledWith('port_req_synthetic', {
        status: 'PORT_IN_PENDING', statusReason: null,
      });
      expect(prisma.phoneNumber.upsert).not.toHaveBeenCalled();
    }
  );

  test('accepts a documented phone-level pending event only for the matching number', async () => {
    prisma.portRequest.findFirst.mockResolvedValueOnce({
      ...portRequest, phoneNumber: '+1 555 000 1111', country: 'US',
    });
    await post({
      port_in_request_sid: 'PI-synthetic',
      port_in_phone_number_sid: 'PN-synthetic',
      phone_number: '+15550001111',
      status: 'pending',
    }).expect(200, { ok: true });
    expect(updatePortStatus).toHaveBeenCalledTimes(1);

    await post({
      port_in_request_sid: 'PI-synthetic',
      port_in_phone_number_sid: 'PN-synthetic',
      phone_number: '+15550009999',
      status: 'pending',
    }).expect(409);
    expect(updatePortStatus).toHaveBeenCalledTimes(1);
  });

  test.each(['completed', 'rejected', 'canceled', 'action_required', 'unknown'])(
    'does not guess a terminal or unsupported %s transition', async (status) => {
      await post({ port_in_request_sid: 'PI-synthetic', status }).expect(422);
      expect(prisma.portRequest.findFirst).not.toHaveBeenCalled();
      expect(updatePortStatus).not.toHaveBeenCalled();
      expect(prisma.phoneNumber.upsert).not.toHaveBeenCalled();
    }
  );

  test('acknowledges a signed but unknown request without writes', async () => {
    prisma.portRequest.findFirst.mockResolvedValueOnce(null);
    await post({ port_in_request_sid: 'PI-unknown', status: 'pending' })
      .expect(200, { ok: true });
    expect(updatePortStatus).not.toHaveBeenCalled();
  });

  test('a late pending event does not regress an already ported request', async () => {
    prisma.portRequest.findFirst.mockResolvedValueOnce({
      ...portRequest, status: 'PORTED_IN',
    });
    await post({ port_in_request_sid: 'PI-synthetic', status: 'pending' })
      .expect(200, { ok: true });
    expect(updatePortStatus).not.toHaveBeenCalled();
  });

  test('retains the legacy request SID alias for existing integrations', async () => {
    await post({ portInSid: 'PI-legacy', status: 'pending' })
      .expect(200, { ok: true });
    expect(prisma.portRequest.findFirst).toHaveBeenCalledWith({
      where: { externalPortId: 'PI-legacy' },
    });
  });
});
