import express from 'express';
import request from 'supertest';

// ---- mocks ----
const mockRecordInboundSms = jest.fn();
jest.mock('../services/smsService.js', () => ({
  recordInboundSms: mockRecordInboundSms,
}));

const mockFindFirst = jest.fn();
jest.mock('../utils/prismaClient.js', () => ({
  __esModule: true,
  default: {
    user: {
      findFirst: mockFindFirst,
    },
  },
}));

const mockNormalizeE164 = jest.fn((n) => `+${String(n)}`);
jest.mock('../utils/phone.js', () => ({
  normalizeE164: jest.fn((n) => `+${String(n)}`),
}));

import router from '../routes/webhooksTwilio.js';
import { recordInboundSms } from '../services/smsService.js';
import prisma from '../utils/prismaClient.js';
import { normalizeE164 } from '../utils/phone.js';

function makeApp() {
  const app = express();
  // routes already add urlencoded middleware, so no global body parser needed
  app.use('/webhooks', router);
  return app;
}

describe('webhooksTwilio routes', () => {
  let app;

  beforeEach(() => {
    app = makeApp();
    jest.clearAllMocks();
  });

  describe('POST /webhooks/sms/inbound', () => {
    it('stores inbound SMS and returns empty TwiML', async () => {
      const payload = {
        From: '+15551234567',
        To: '+15557654321',
        Body: 'Hello from Twilio',
      };

      const res = await request(app)
        .post('/webhooks/sms/inbound')
        .type('form')
        .send(payload)
        .expect(200);

      // basic XML response
      expect(res.headers['content-type']).toMatch(/text\/xml/);
      expect(res.text).toContain('<Response>');
      // no auto-reply body
      expect(res.text).not.toContain('Hello');

      // service called with expected payload
      expect(recordInboundSms).toHaveBeenCalledTimes(1);
      expect(recordInboundSms).toHaveBeenCalledWith({
        toNumber: payload.To,
        fromNumber: payload.From,
        body: payload.Body,
        provider: 'twilio',
      });
    });

    it('no-ops if required fields are missing', async () => {
      const res = await request(app)
        .post('/webhooks/sms/inbound')
        .type('form')
        .send({ Body: 'Missing numbers' })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/xml/);
      expect(res.text).toContain('<Response>');
      expect(recordInboundSms).not.toHaveBeenCalled();
    });
  });

  describe('POST /webhooks/voice/alias/legA', () => {
    it('returns TwiML with Gather pointing to confirm endpoint', async () => {
      const query = {
        userId: 'user-123',
        from: '+15550001111',
        to: '+15550002222',
      };

      const res = await request(app)
        .post('/webhooks/voice/alias/legA')
        .query(query)
        .type('form')
        .send({}) // body can be empty; Twilio sends form-encoded
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/xml/);

      // Gather with an action URL containing encoded query params
      expect(res.text).toContain('<Gather');
      expect(res.text).toContain('/webhooks/voice/alias/confirm');
      expect(res.text).toContain(encodeURIComponent(query.userId));
      expect(res.text).toContain(encodeURIComponent(query.from));
      expect(res.text).toContain(encodeURIComponent(query.to));

      // Prompt text
      expect(res.text).toContain(
        'You have a Chatforia call. Press 1 to connect.'
      );
      expect(res.text).toContain('We did not receive any input. Goodbye.');
    });
  });

  describe('POST /webhooks/voice/alias/confirm', () => {
    it('dials destination when digit 1 is pressed', async () => {
      const res = await request(app)
        .post('/webhooks/voice/alias/confirm')
        .query({ from: '+15550001111', to: '+15550002222' })
        .type('form')
        .send({ Digits: '1' })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/xml/);

      // normalizeE164 should be used for both numbers
      expect(normalizeE164).toHaveBeenCalledTimes(2);
      expect(normalizeE164).toHaveBeenCalledWith('+15550002222');
      expect(normalizeE164).toHaveBeenCalledWith('+15550001111');

      // TwiML should contain a Dial with callerId and Number
      expect(res.text).toContain('<Dial');
      expect(res.text).toContain('callerId="+' /* from mockNormalizeE164 */);
      expect(res.text).toContain('<Number>+15550002222'); // dest normalized
      expect(res.text).toContain('Connecting your call.');
    });

    it('hangs up when digit is not 1 or params are missing', async () => {
      const res = await request(app)
        .post('/webhooks/voice/alias/confirm')
        .query({ from: '+15550001111', to: '+15550002222' })
        .type('form')
        .send({ Digits: '9' })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/xml/);
      expect(res.text).toContain('Call cancelled. Goodbye.');
      expect(res.text).toContain('<Hangup');
      expect(normalizeE164).not.toHaveBeenCalled();
    });
  });

  describe('POST /webhooks/voice/inbound', () => {
    it('handles missing To with an error message', async () => {
      const res = await request(app)
        .post('/webhooks/voice/inbound')
        .type('form')
        .send({ From: '+15550001111' })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/xml/);
      expect(res.text).toContain(
        'We could not determine the destination number. Goodbye.'
      );
      expect(res.text).toContain('<Hangup');
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('handles no matching user / no forward number', async () => {
      mockFindFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/webhooks/voice/inbound')
        .type('form')
        .send({ To: '+15550003333', From: '+15550004444' })
        .expect(200);

      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      expect(res.text).toContain(
        'The person you are trying to reach is not available. Goodbye.'
      );
      expect(res.text).toContain('<Hangup');
    });

    it('dials the user’s forwarding number when available', async () => {
      mockFindFirst.mockResolvedValueOnce({
        forwardPhoneNumber: '+15550009999',
      });

      const res = await request(app)
        .post('/webhooks/voice/inbound')
        .type('form')
        .send({ To: '+15550003333', From: '+15550004444' })
        .expect(200);

      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      const where = prisma.user.findFirst.mock.calls[0][0].where;
      expect(where.assignedNumbers).toBeDefined();

      // normalizeE164 should be used for DID and forwardPhoneNumber
      expect(normalizeE164).toHaveBeenCalledWith('+15550003333');
      expect(normalizeE164).toHaveBeenCalledWith('+15550009999');

      expect(res.headers['content-type']).toMatch(/text\/xml/);
      expect(res.text).toContain('<Dial');
      expect(res.text).toContain('<Number>+15550009999');
    });
  });
});
