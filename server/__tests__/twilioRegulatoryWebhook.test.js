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

  app.use(
    express.urlencoded({
      extended: false,
    })
  );

  app.use('/webhooks', router);

  return app;
}

function signedPost({
  app,
  body,
  signatureBody = body,
  signatureToken = AUTH_TOKEN,
}) {
  const url =
    'http://127.0.0.1/webhooks/twilio/regulatory-status';

  const signature =
    twilio.getExpectedTwilioSignature(
      signatureToken,
      url,
      signatureBody
    );

  return request(app)
    .post('/webhooks/twilio/regulatory-status')
    .set('Host', '127.0.0.1')
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
