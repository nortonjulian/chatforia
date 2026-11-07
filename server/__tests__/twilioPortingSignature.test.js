import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';

import { installTwilioPortingGuard } from '../middleware/twilioPortingSignature.js';

const originalEnv = process.env;
let prismaMock;
let updatePortStatusMock;

await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    portRequest: { findFirst: jest.fn() },
    phoneNumber: { upsert: jest.fn() },
  };
  return { default: prismaMock };
});
await jest.unstable_mockModule('../services/portingService.js', () => {
  updatePortStatusMock = jest.fn();
  return { updatePortStatus: updatePortStatusMock };
});
const { default: portingRouter } = await import('../routes/twilioPortingWebhook.js');

function appWithGuard() {
  const app = express();
  installTwilioPortingGuard(app);
  app.use(express.json());
  app.use(['/webhooks/twilio/porting', '/api/webhooks/twilio/porting'], portingRouter);
  return app;
}

function signedRequest(app, path, body, token = process.env.TWILIO_AUTH_TOKEN) {
  const raw = JSON.stringify(body);
  const hash = twilio.getExpectedBodyHash(raw);
  const url = `https://api.example.test${path}?bodySHA256=${hash}`;
  const signature = twilio.getExpectedTwilioSignature(token, url, {});
  return request(app).post(`${path}?bodySHA256=${hash}`)
    .set('Content-Type', 'application/json')
    .set('X-Twilio-Signature', signature)
    .send(raw);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...originalEnv,
    TWILIO_AUTH_TOKEN: 'synthetic_porting_token',
    TWILIO_PORTING_WEBHOOK_URL: 'https://api.example.test/webhooks/twilio/porting',
  };
  prismaMock.portRequest.findFirst.mockResolvedValue({
    id: 'port_req_synthetic', phoneNumber: '+15550001111',
  });
  updatePortStatusMock.mockResolvedValue({ userId: 7, phoneNumber: '+15550001111' });
});
afterAll(() => { process.env = originalEnv; });

describe('Twilio porting signature guard', () => {
  test.each(['/webhooks/twilio/porting', '/api/webhooks/twilio/porting'])(
    'rejects missing and invalid signatures before state changes at %s', async (path) => {
      const app = appWithGuard();
      const body = { port_in_request_sid: 'synthetic-port', status: 'submitted' };
      await request(app).post(path).send(body).expect(403);
      await signedRequest(app, path, body, 'wrong_synthetic_token').expect(403);
      expect(prismaMock.portRequest.findFirst).not.toHaveBeenCalled();
      expect(updatePortStatusMock).not.toHaveBeenCalled();
      expect(prismaMock.phoneNumber.upsert).not.toHaveBeenCalled();
    }
  );

  test.each(['/webhooks/twilio/porting', '/api/webhooks/twilio/porting'])(
    'accepts a valid signed JSON callback at %s', async (path) => {
      const app = appWithGuard();
      const body = { port_in_request_sid: 'synthetic-port', status: 'submitted' };
      await signedRequest(app, path, body)
        .set('Host', 'internal.example.test')
        .set('X-Forwarded-Proto', 'http')
        .expect(200, { ok: true });
      expect(prismaMock.portRequest.findFirst).toHaveBeenCalledWith({
        where: { externalPortId: 'synthetic-port' },
      });
      expect(updatePortStatusMock).toHaveBeenCalledWith('port_req_synthetic', expect.objectContaining({
        status: 'PORT_IN_PENDING',
      }));
    }
  );

  test('rejects a changed JSON body, a spoofed public URL, and missing configuration', async () => {
    const app = appWithGuard();
    const path = '/webhooks/twilio/porting';
    const body = { port_in_request_sid: 'synthetic-port', status: 'submitted' };
    const raw = JSON.stringify(body);
    const hash = twilio.getExpectedBodyHash(raw);
    const signature = twilio.getExpectedTwilioSignature(
      process.env.TWILIO_AUTH_TOKEN,
      `https://api.example.test${path}?bodySHA256=${hash}`,
      {}
    );
    await request(app).post(`${path}?bodySHA256=${hash}`)
      .set('X-Twilio-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ ...body, status: 'completed' })).expect(403);
    await request(app).post(`${path}?bodySHA256=${hash}`)
      .set('X-Twilio-Signature', twilio.getExpectedTwilioSignature(
        process.env.TWILIO_AUTH_TOKEN,
        `https://attacker.example.test${path}?bodySHA256=${hash}`, {}
      ))
      .set('Host', 'attacker.example.test')
      .set('X-Forwarded-Proto', 'https')
      .set('Content-Type', 'application/json').send(raw).expect(403);
    await request(app).post(path)
      .set('X-Twilio-Signature', signature)
      .set('Content-Type', 'application/json').send(raw).expect(403);
    delete process.env.TWILIO_AUTH_TOKEN;
    await request(app).post(path).send(body).expect(503);
    expect(prismaMock.portRequest.findFirst).not.toHaveBeenCalled();
    expect(updatePortStatusMock).not.toHaveBeenCalled();
  });
});
