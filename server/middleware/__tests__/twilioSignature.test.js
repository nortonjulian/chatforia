import { afterAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';

import { httpsRedirect } from '../httpsRedirect.js';
import { installTwilioCallbackGuards } from '../twilioSignature.js';

const originalEnv = process.env;
const token = 'synthetic_twilio_auth_token';
const origin = 'https://api.example.test';
const paths = [
  '/webhooks/voice/inbound',
  '/api/webhooks/voice/inbound',
  '/webhooks/voice/inbound/after-dial?reservationKey=synthetic%3A1',
  '/api/webhooks/voice/status',
  '/webhooks/sms/twilio',
  '/api/webhooks/sms/twilio',
  '/webhooks/status',
  '/webhooks/status/status',
];

function testApp(effect) {
  const app = express();
  app.set('trust proxy', 1);
  installTwilioCallbackGuards(app);
  for (const path of paths) {
    app.post(path.split('?')[0], (req, res) => {
      effect(req.body);
      res.status(200).send('handled');
    });
  }
  return app;
}

function signedPost(app, path, body, signedUrl = origin + path) {
  const signature = twilio.getExpectedTwilioSignature(token, signedUrl, body);
  return request(app)
    .post(path)
    .set('Host', 'internal.example.test')
    .set('X-Forwarded-Host', 'attacker.example.test')
    .set('X-Forwarded-Proto', 'http')
    .set('X-Twilio-Signature', signature)
    .type('form')
    .send(body);
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    TWILIO_AUTH_TOKEN: token,
    TWILIO_WEBHOOK_BASE_URL: origin,
    TWILIO_VOICE_WEBHOOK_URL: `${origin}/configured-voice-path`,
    APP_API_ORIGIN: '',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('Twilio callback signature gate', () => {
  test.each(paths)('accepts a signed callback at %s despite proxy headers', async (path) => {
    const effect = jest.fn();
    const body = { CallSid: 'CA-synthetic', MessageSid: 'SM-synthetic' };
    const response = await signedPost(testApp(effect), path, body);
    expect(response.status).toBe(200);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test.each(paths)('rejects missing and invalid signatures before %s side effects', async (path) => {
    const effect = jest.fn();
    const app = testApp(effect);
    const body = { CallSid: 'CA-synthetic', MessageSid: 'SM-synthetic' };
    await request(app).post(path).type('form').send(body).expect(403);
    await request(app).post(path).set('X-Twilio-Signature', 'invalid')
      .type('form').send(body).expect(403);
    expect(effect).not.toHaveBeenCalled();
  });

  test('rejects altered form fields and a signature for another public URL', async () => {
    const effect = jest.fn();
    const app = testApp(effect);
    const path = '/api/webhooks/sms/twilio';
    await signedPost(app, path, { Body: 'changed' }, origin + '/wrong-path').expect(403);
    const signature = twilio.getExpectedTwilioSignature(token, origin + path, { Body: 'original' });
    await request(app).post(path).set('X-Twilio-Signature', signature)
      .type('form').send({ Body: 'changed' }).expect(403);
    expect(effect).not.toHaveBeenCalled();
  });

  test('uses the original callback path when the configured base contains /api', async () => {
    process.env.TWILIO_WEBHOOK_BASE_URL = `${origin}/api`;
    process.env.TWILIO_VOICE_WEBHOOK_URL = `${origin}/api/webhooks/voice/inbound`;
    const effect = jest.fn();
    const path = '/api/webhooks/sms/twilio';
    await signedPost(testApp(effect), path, { MessageSid: 'SM-base-path' }).expect(200);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test('accepts repeated form parameter names as the Twilio SDK does', async () => {
    const effect = jest.fn();
    const path = '/api/webhooks/sms/twilio';
    const body = { Tag: ['one', 'two'] };
    const signature = twilio.getExpectedTwilioSignature(token, origin + path, body);
    await request(testApp(effect)).post(path)
      .set('X-Twilio-Signature', signature)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('Tag=one&Tag=two').expect(200);
    expect(effect).toHaveBeenCalledWith(body);
  });

  test('rejects a bad signature before a production HTTPS redirect', async () => {
    const effect = jest.fn();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const redirect = httpsRedirect();
    process.env.NODE_ENV = previousNodeEnv;
    const app = express();
    installTwilioCallbackGuards(app);
    app.use(redirect);
    app.post('/api/webhooks/voice/inbound', (_req, res) => {
      effect();
      res.sendStatus(200);
    });

    await request(app).post('/api/webhooks/voice/inbound')
      .set('Host', 'attacker.example.test')
      .set('X-Forwarded-Proto', 'http')
      .type('form').send({ CallSid: 'CA-synthetic' }).expect(403);
    expect(effect).not.toHaveBeenCalled();

    const body = { CallSid: 'CA-synthetic' };
    const signature = twilio.getExpectedTwilioSignature(
      token, `${origin}/api/webhooks/voice/inbound`, body
    );
    await request(app).post('/api/webhooks/voice/inbound')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Twilio-Signature', signature)
      .type('form').send(body).expect(200);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test('fails closed when the token or public origin is absent', async () => {
    const effect = jest.fn();
    const app = testApp(effect);
    delete process.env.TWILIO_AUTH_TOKEN;
    await request(app).post('/webhooks/voice/inbound').type('form').send({}).expect(503);
    process.env.TWILIO_AUTH_TOKEN = token;
    delete process.env.TWILIO_VOICE_WEBHOOK_URL;
    delete process.env.TWILIO_WEBHOOK_BASE_URL;
    delete process.env.APP_API_ORIGIN;
    await request(app).post('/webhooks/voice/inbound').type('form').send({}).expect(503);
    expect(effect).not.toHaveBeenCalled();
  });
});
