/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import twilio from 'twilio';

const syncRegulatoryBundleStatusBySidMock =
  jest.fn();

jest.unstable_mockModule(
  '../services/numberRegulatoryService.js',
  () => ({
    syncRegulatoryBundleStatusBySid:
      syncRegulatoryBundleStatusBySidMock,
  })
);

const AUTH_TOKEN = 'regulatory_webhook_test_token';

const ORIGINAL_AUTH_TOKEN =
  process.env.TWILIO_AUTH_TOKEN;

process.env.TWILIO_AUTH_TOKEN =
  AUTH_TOKEN;

const { default: router } =
  await import(
    '../routes/twilioRegulatoryWebhook.js'
  );

const BU =
  'BU22222222222222222222222222222222';

function makeApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    express.urlencoded({
      extended: false,
    })
  );

  app.use('/webhooks', router);
  app.use('/api/webhooks', router);

  return app;
}

function signedPost({
  app,
  body,
  signatureBody = body,
  signatureToken = AUTH_TOKEN,
  path = '/webhooks/twilio/regulatory-status',
  host = '127.0.0.1',
  protocol = 'http',
}) {
  const url = `${protocol}://${host}${path}`;

  const signature =
    twilio.getExpectedTwilioSignature(
      signatureToken,
      url,
      signatureBody
    );

  return request(app)
    .post(path)
    .set('Host', host)
    .set('X-Forwarded-Proto', protocol)
    .set('X-Twilio-Signature', signature)
    .type('form')
    .send(body);
}

describe(
  'Twilio regulatory status webhook',
  () => {
    let app;
    beforeAll(() => {
      app = makeApp();
    });

    afterAll(() => {
      if (
        ORIGINAL_AUTH_TOKEN === undefined
      ) {
        delete process.env.TWILIO_AUTH_TOKEN;
      } else {
        process.env.TWILIO_AUTH_TOKEN =
          ORIGINAL_AUTH_TOKEN;
      }
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test.each([
      '/webhooks/twilio/regulatory-status',
      '/api/webhooks/twilio/regulatory-status',
    ])(
      'accepts documented BundleSID over the signed public URL at %s',
      async (path) => {
        syncRegulatoryBundleStatusBySidMock.mockResolvedValue({
          profile: { status: 'IN_REVIEW' },
          reason: null,
        });
        const body = {
          AccountSID: 'AC11111111111111111111111111111111',
          BundleSID: BU,
          Status: 'in-review',
        };
        const response = await signedPost({
          app, body, path, host: 'api.example.test', protocol: 'https',
        });
        expect(response.status).toBe(200);
        expect(syncRegulatoryBundleStatusBySidMock).toHaveBeenCalledWith({
          bundleSid: BU,
        });
      }
    );

    test.each([
      '/webhooks/twilio/regulatory-status',
      '/api/webhooks/twilio/regulatory-status',
    ])(
      'rejects missing and invalid signatures before synchronization at %s',
      async (path) => {
        const body = { BundleSID: BU, Status: 'twilio-approved' };
        await request(app).post(path)
          .set('Host', 'api.example.test')
          .set('X-Forwarded-Proto', 'https')
          .type('form').send(body).expect(400);
        await signedPost({
          app, body, path, host: 'api.example.test', protocol: 'https',
          signatureToken: 'wrong_synthetic_token',
        }).expect(403);
        expect(syncRegulatoryBundleStatusBySidMock).not.toHaveBeenCalled();
      }
    );

    test(
      'accepts a valid Twilio signature and synchronizes by Bundle SID',
      async () => {
        syncRegulatoryBundleStatusBySidMock
          .mockResolvedValue({
            profile: {
              id: 7,
              bundleSid: BU,
              status: 'APPROVED',
            },
            approved: true,
            knownStatus: true,
            reason: null,
          });

        const body = {
          BundleSid: BU,
          Status: 'twilio-approved',
        };

        const response =
          await signedPost({
            app,
            body,
          });

        expect(response.status).toBe(200);

        expect(response.body).toEqual({
          ok: true,
          synchronized: true,
          status: 'APPROVED',
        });

        expect(
          syncRegulatoryBundleStatusBySidMock
        ).toHaveBeenCalledTimes(1);

        expect(
          syncRegulatoryBundleStatusBySidMock
        ).toHaveBeenCalledWith({
          bundleSid: BU,
        });
      }
    );

    test(
      'rejects an invalid Twilio signature before synchronization',
      async () => {
        const body = {
          BundleSid: BU,
        };

        const response =
          await signedPost({
            app,
            body,
            signatureToken:
              'definitely_the_wrong_token',
          });

        expect(response.status).toBe(403);

        expect(
          syncRegulatoryBundleStatusBySidMock
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'rejects a malformed Bundle SID without synchronization',
      async () => {
        const body = {
          BundleSid: 'not-a-bundle-sid',
        };

        const response =
          await signedPost({
            app,
            body,
          });

        expect(response.status).toBe(400);

        expect(response.body).toEqual({
          ok: false,
          reason: 'invalid-bundle-sid',
        });

        expect(
          syncRegulatoryBundleStatusBySidMock
        ).not.toHaveBeenCalled();
      }
    );

    test(
      'acknowledges an unknown Bundle without changing state',
      async () => {
        syncRegulatoryBundleStatusBySidMock
          .mockResolvedValue({
            profile: null,
            approved: false,
            knownStatus: false,
            reason: 'profile-not-found',
          });

        const response =
          await signedPost({
            app,
            body: {
              BundleSid: BU,
            },
          });

        expect(response.status).toBe(200);

        expect(response.body).toEqual({
          ok: true,
          synchronized: false,
          reason: 'profile-not-found',
        });
      }
    );

    test(
      'does not trust callback status as approval authority',
      async () => {
        syncRegulatoryBundleStatusBySidMock
          .mockResolvedValue({
            profile: {
              id: 7,
              bundleSid: BU,
              status: 'IN_REVIEW',
            },
            approved: false,
            knownStatus: true,
            reason: null,
          });

        const response =
          await signedPost({
            app,
            body: {
              BundleSid: BU,

              // Deliberately false/untrusted.
              Status: 'twilio-approved',
              BundleStatus:
                'twilio-approved',
            },
          });

        expect(response.status).toBe(200);

        expect(response.body.status).toBe(
          'IN_REVIEW'
        );

        expect(
          syncRegulatoryBundleStatusBySidMock
        ).toHaveBeenCalledWith({
          bundleSid: BU,
        });
      }
    );

    test(
      'returns a retryable error when authoritative synchronization fails',
      async () => {
        syncRegulatoryBundleStatusBySidMock
          .mockRejectedValue(
            new Error(
              'simulated provider failure'
            )
          );

        const response =
          await signedPost({
            app,
            body: {
              BundleSid: BU,
            },
          });

        expect(response.status).toBe(503);

        expect(response.body).toEqual({
          ok: false,
          synchronized: false,
          reason:
            'synchronization-failed',
        });
      }
    );
  }
);
